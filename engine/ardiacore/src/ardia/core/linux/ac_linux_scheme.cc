// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/linux/ac_linux_scheme.h"

#include <algorithm>
#include <cstdlib>
#include <string_view>
#include <utility>
#include <vector>

#include "ardia/core/linux/ac_linux_bridge.h"
#include "ardia/core/linux/ac_linux_host.h"
#include "ardia/core/linux/ac_linux_window.h"
#include "base/base_paths.h"
#include "base/byte_size.h"
#include "base/check.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/memory/self_deleting.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/strings/escape.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/global_routing_id.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "mojo/public/cpp/system/data_pipe.h"
#include "net/base/mime_util.h"
#include "net/base/net_errors.h"
#include "net/http/http_response_headers.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/resource_request_body.h"
#include "services/network/public/cpp/self_deleting_url_loader_factory.h"
#include "services/network/public/cpp/url_loader_completion_status.h"
#include "services/network/public/mojom/url_loader.mojom.h"
#include "services/network/public/mojom/url_loader_factory.mojom.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "url/gurl.h"

namespace ardia::linux_host {

namespace {

constexpr size_t kMaxBodyBytes = 64u * 1024u * 1024u;
constexpr char kUIDirSwitchEnv[] = "ARDIA_UI_DIR";
constexpr char kUIDevURLEnv[] = "ARDIA_UI_DEV_URL";

struct Response {
  int status = 200;
  std::string mime_type;
  std::string body;
};

void CompleteWithError(
    mojo::PendingRemote<network::mojom::URLLoaderClient> client_remote,
    int error) {
  mojo::Remote<network::mojom::URLLoaderClient> client(std::move(client_remote));
  client->OnComplete(network::URLLoaderCompletionStatus(error));
}

std::string StatusLine(int status) {
  switch (status) {
    case 200:
      return "HTTP/1.1 200 OK";
    case 204:
      return "HTTP/1.1 204 No Content";
    case 404:
      return "HTTP/1.1 404 Not Found";
    default:
      return "HTTP/1.1 " + base::NumberToString(status) + " Error";
  }
}

void Send(mojo::PendingRemote<network::mojom::URLLoaderClient> client_remote,
          const std::optional<url::Origin>& initiator,
          Response response) {
  if (response.body.size() > kMaxBodyBytes) {
    CompleteWithError(std::move(client_remote), net::ERR_INSUFFICIENT_RESOURCES);
    return;
  }
  auto headers = base::MakeRefCounted<net::HttpResponseHeaders>(
      StatusLine(response.status));
  if (!response.mime_type.empty()) {
    headers->AddHeader("Content-Type", response.mime_type);
  }
  headers->AddHeader("Cache-Control", "no-cache");
  headers->AddHeader("X-Content-Type-Options", "nosniff");
  if (initiator && !initiator->opaque()) {
    headers->AddHeader("Access-Control-Allow-Origin", initiator->Serialize());
    headers->AddHeader("Access-Control-Allow-Headers", "Content-Type");
    headers->AddHeader("Access-Control-Allow-Methods", "GET, POST");
    headers->AddHeader("Vary", "Origin");
  }

  auto head = network::mojom::URLResponseHead::New();
  head->headers = headers;
  head->mime_type = response.mime_type;
  head->charset = "utf-8";
  head->content_length = static_cast<int64_t>(response.body.size());
  const base::Time now = base::Time::Now();
  const base::TimeTicks now_ticks = base::TimeTicks::Now();
  head->request_time = now;
  head->response_time = now;
  head->request_start = now_ticks;
  head->response_start = now_ticks;

  mojo::ScopedDataPipeProducerHandle producer;
  mojo::ScopedDataPipeConsumerHandle consumer;
  const uint32_t capacity =
      static_cast<uint32_t>(std::max<size_t>(response.body.size(), 1));
  if (mojo::CreateDataPipe(capacity, producer, consumer) != MOJO_RESULT_OK) {
    CompleteWithError(std::move(client_remote), net::ERR_INSUFFICIENT_RESOURCES);
    return;
  }
  if (!response.body.empty() &&
      producer->WriteAllData(base::as_byte_span(response.body)) !=
          MOJO_RESULT_OK) {
    CompleteWithError(std::move(client_remote), net::ERR_FAILED);
    return;
  }
  producer.reset();

  mojo::Remote<network::mojom::URLLoaderClient> client(std::move(client_remote));
  client->OnReceiveResponse(std::move(head), std::move(consumer), std::nullopt);
  network::URLLoaderCompletionStatus status(net::OK);
  status.decoded_body_length = base::ByteSize(response.body.size());
  status.encoded_body_length = base::ByteSize(response.body.size());
  status.encoded_data_length = base::ByteSize(response.body.size());
  status.completion_time = base::TimeTicks::Now();
  client->OnComplete(status);
}

std::string MimeTypeFor(const base::FilePath& path) {
  const base::FilePath::StringType extension =
      base::ToLowerASCII(path.Extension());
  if (extension == ".js" || extension == ".mjs" || extension == ".cjs") {
    return "text/javascript";
  }
  if (extension == ".map" || extension == ".json") {
    return "application/json";
  }
  if (extension == ".wasm") {
    return "application/wasm";
  }
  if (extension == ".woff2") {
    return "font/woff2";
  }
  if (extension == ".woff") {
    return "font/woff";
  }
  if (extension == ".ttf") {
    return "font/ttf";
  }
  if (extension == ".otf") {
    return "font/otf";
  }
  std::string mime_type;
  if (net::GetWellKnownMimeTypeFromFile(path, &mime_type)) {
    return mime_type;
  }
  return "application/octet-stream";
}

std::optional<base::FilePath> ResolveShellPath(const GURL& url) {
  if (!url.SchemeIs(kShellScheme) || url.host() != kShellHost) {
    return std::nullopt;
  }
  std::string path = base::UnescapeBinaryURLComponent(url.path());
  while (!path.empty() && path.front() == '/') {
    path.erase(path.begin());
  }
  if (path.empty()) {
    path = "index.html";
  }
  if (path.find('\0') != std::string::npos ||
      path.find('\\') != std::string::npos) {
    return std::nullopt;
  }
  const base::FilePath relative(path);
  if (relative.IsAbsolute() || relative.ReferencesParent()) {
    return std::nullopt;
  }
  for (const std::string& part : base::SplitString(
           path, "/", base::KEEP_WHITESPACE, base::SPLIT_WANT_ALL)) {
    if (part.empty() || part == "." || part == "..") {
      return std::nullopt;
    }
  }
  const base::FilePath root = UIDirectory();
  if (root.empty()) {
    return std::nullopt;
  }
  return root.Append(relative);
}

Response ReadShellFile(base::FilePath root, base::FilePath file) {
  Response response;
  const base::FilePath real_root = base::MakeAbsoluteFilePath(root);
  const base::FilePath real_file = base::MakeAbsoluteFilePath(file);
  if (real_root.empty() || real_file.empty() ||
      !(real_root == real_file || real_root.IsParent(real_file)) ||
      base::DirectoryExists(real_file) ||
      !base::ReadFileToStringWithMaxSize(real_file, &response.body,
                                         kMaxBodyBytes)) {
    response.status = 404;
    response.body.clear();
    response.mime_type = "text/plain";
    return response;
  }
  response.mime_type = MimeTypeFor(real_file);
  return response;
}

struct NativeRequest {
  std::vector<std::string> parts;
};

std::optional<NativeRequest> ParseNativeURL(const GURL& url) {
  if (!url.SchemeIs(kNativeScheme)) {
    return std::nullopt;
  }
  std::string_view rest = url.spec();
  rest.remove_prefix(std::min(rest.size(), std::string_view(kNativeScheme).size() + 1));
  while (!rest.empty() && rest.front() == '/') {
    rest.remove_prefix(1);
  }
  const size_t end = rest.find_first_of("?#");
  if (end != std::string_view::npos) {
    rest = rest.substr(0, end);
  }
  NativeRequest request;
  for (std::string_view part : base::SplitStringPiece(
           rest, "/", base::KEEP_WHITESPACE, base::SPLIT_WANT_ALL)) {
    request.parts.push_back(base::UnescapeBinaryURLComponent(part));
  }
  if (request.parts.empty()) {
    return std::nullopt;
  }
  return request;
}

std::optional<std::string> RequestBody(const network::ResourceRequest& request) {
  std::string body;
  if (!request.request_body) {
    return body;
  }
  for (const network::DataElement& element :
       *request.request_body->elements()) {
    if (element.type() != network::DataElement::Tag::kBytes) {
      return std::nullopt;
    }
    body.append(element.As<network::DataElementBytes>().AsStringView());
    if (body.size() > kMaxBodyBytes) {
      return std::nullopt;
    }
  }
  return body;
}

Response JsonResponse(std::string json) {
  Response response;
  response.mime_type = "application/json";
  response.body = std::move(json);
  return response;
}

class ShellURLLoaderFactory : public network::SelfDeletingURLLoaderFactory {
 public:
  ShellURLLoaderFactory(
      std::string scheme,
      content::FrameTreeNodeId navigation_node,
      content::GlobalRenderFrameHostId frame,
      mojo::PendingReceiver<network::mojom::URLLoaderFactory> receiver,
      base::SelfDeletingPassKey key)
      : network::SelfDeletingURLLoaderFactory(std::move(receiver), key),
        scheme_(std::move(scheme)),
        navigation_node_(navigation_node),
        frame_(frame) {}

  ShellURLLoaderFactory(const ShellURLLoaderFactory&) = delete;
  ShellURLLoaderFactory& operator=(const ShellURLLoaderFactory&) = delete;

 private:
  ~ShellURLLoaderFactory() override = default;

  content::WebContents* AllowedContents() const {
    if (navigation_node_) {
      content::WebContents* contents =
          content::WebContents::FromFrameTreeNodeId(navigation_node_);
      if (!contents ||
          contents->GetPrimaryMainFrame()->GetFrameTreeNodeId() !=
              navigation_node_ ||
          !(IsShellContents(contents) || IsPendingShellDocument(contents))) {
        return nullptr;
      }
      return contents;
    }
    content::RenderFrameHost* frame = content::RenderFrameHost::FromID(frame_);
    if (!frame || !IsShellFrame(frame)) {
      return nullptr;
    }
    return content::WebContents::FromRenderFrameHost(frame);
  }

  void CreateLoaderAndStart(
      mojo::PendingReceiver<network::mojom::URLLoader> loader,
      int32_t request_id,
      uint32_t options,
      const network::ResourceRequest& request,
      mojo::PendingRemote<network::mojom::URLLoaderClient> client,
      const net::MutableNetworkTrafficAnnotationTag& traffic_annotation)
      override {
    DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
    if (!request.url.SchemeIs(scheme_)) {
      ReportBadMessage("ardia: the shell factory got another scheme");
      CompleteWithError(std::move(client), net::ERR_FAILED);
      return;
    }
    content::WebContents* contents = AllowedContents();
    if (!contents) {
      CompleteWithError(std::move(client), net::ERR_ACCESS_DENIED);
      return;
    }
    if (!navigation_node_ && request.request_initiator &&
        !request.request_initiator->IsSameOriginWith(ShellOrigin())) {
      CompleteWithError(std::move(client), net::ERR_ACCESS_DENIED);
      return;
    }
    if (request.url.SchemeIs(kNativeScheme)) {
      ServeNative(contents, options, request, std::move(client));
      return;
    }
    ServeFile(request, std::move(client));
  }

  void ServeFile(const network::ResourceRequest& request,
                 mojo::PendingRemote<network::mojom::URLLoaderClient> client) {
    if (request.method != "GET" && request.method != "HEAD") {
      CompleteWithError(std::move(client), net::ERR_METHOD_NOT_SUPPORTED);
      return;
    }
    std::optional<base::FilePath> file = ResolveShellPath(request.url);
    if (!file) {
      CompleteWithError(std::move(client), net::ERR_INVALID_URL);
      return;
    }
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE,
        {base::MayBlock(), base::TaskPriority::USER_BLOCKING,
         base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN},
        base::BindOnce(&ReadShellFile, UIDirectory(), *file),
        base::BindOnce(&Send, std::move(client), request.request_initiator));
  }

  void ServeNative(content::WebContents* contents,
                   uint32_t options,
                   const network::ResourceRequest& request,
                   mojo::PendingRemote<network::mojom::URLLoaderClient> client) {
    const std::optional<url::Origin> initiator = request.request_initiator;
    if (request.method == "OPTIONS") {
      Response response;
      response.status = 204;
      Send(std::move(client), initiator, std::move(response));
      return;
    }
    std::optional<NativeRequest> parsed = ParseNativeURL(request.url);
    if (!parsed) {
      CompleteWithError(std::move(client), net::ERR_INVALID_URL);
      return;
    }
    if (parsed->parts.size() == 1 && parsed->parts[0] == "constants") {
      std::optional<std::string> json =
          base::WriteJson(Bridge::Get().Constants());
      Send(std::move(client), initiator, JsonResponse(json.value_or("{}")));
      return;
    }
    if (parsed->parts.size() != 3 || parsed->parts[0] != "call" ||
        request.method != "POST") {
      CompleteWithError(std::move(client), net::ERR_INVALID_URL);
      return;
    }
    std::optional<std::string> body = RequestBody(request);
    if (!body) {
      Send(std::move(client), initiator,
           JsonResponse(R"({"error":{"code":"ERR_INVALID_ARGUMENTS","message":"the call body is not readable"}})"));
      return;
    }
    CallContext context;
    context.window = LinuxWindow::ForShell(contents);
    context.shell = contents;
    context.sync = (options & network::mojom::kURLLoadOptionSynchronous) != 0;
    Bridge::Get().Dispatch(
        context, parsed->parts[1], parsed->parts[2], *body,
        base::BindOnce(
            [](mojo::PendingRemote<network::mojom::URLLoaderClient> client,
               std::optional<url::Origin> initiator, std::string json) {
              Send(std::move(client), initiator, JsonResponse(std::move(json)));
            },
            std::move(client), initiator));
  }

  const std::string scheme_;
  const content::FrameTreeNodeId navigation_node_;
  const content::GlobalRenderFrameHostId frame_;
};

mojo::PendingRemote<network::mojom::URLLoaderFactory> MakeFactory(
    std::string scheme,
    content::FrameTreeNodeId navigation_node,
    content::GlobalRenderFrameHostId frame) {
  mojo::PendingRemote<network::mojom::URLLoaderFactory> remote;
  base::MakeSelfDeleting<ShellURLLoaderFactory>(
      std::move(scheme), navigation_node, frame,
      remote.InitWithNewPipeAndPassReceiver());
  return remote;
}

std::string EnvValue(const char* name) {
  const char* value = getenv(name);
  return value ? std::string(value) : std::string();
}

}

std::optional<std::string> DevServerURL() {
#if defined(OFFICIAL_BUILD)
  return std::nullopt;
#else
  std::string url = EnvValue(kUIDevURLEnv);
  if (url.empty() || !GURL(url).is_valid() || !GURL(url).SchemeIsHTTPOrHTTPS()) {
    return std::nullopt;
  }
  return url;
#endif
}

url::Origin ShellOrigin() {
  if (std::optional<std::string> dev = DevServerURL()) {
    return url::Origin::Create(GURL(*dev));
  }
  return url::Origin::Create(
      GURL(std::string(kShellScheme) + "://" + kShellHost + "/"));
}

base::FilePath UIDirectory() {
  static base::NoDestructor<base::FilePath> directory([] {
    std::string configured = EnvValue(kUIDirSwitchEnv);
    if (!configured.empty()) {
      return base::FilePath(configured);
    }
    base::FilePath exe_dir;
    if (!base::PathService::Get(base::DIR_EXE, &exe_dir)) {
      return base::FilePath();
    }
    return exe_dir.Append(FILE_PATH_LITERAL("resources"))
        .Append(FILE_PATH_LITERAL("ui"));
  }());
  return *directory;
}

mojo::PendingRemote<network::mojom::URLLoaderFactory>
CreateShellNavigationURLLoaderFactory(
    const std::string& scheme,
    content::FrameTreeNodeId frame_tree_node_id) {
  if (scheme != kShellScheme || !frame_tree_node_id) {
    return mojo::PendingRemote<network::mojom::URLLoaderFactory>();
  }
  content::WebContents* contents =
      content::WebContents::FromFrameTreeNodeId(frame_tree_node_id);
  if (!contents || !(IsShellContents(contents) || IsPendingShellDocument(contents))) {
    return mojo::PendingRemote<network::mojom::URLLoaderFactory>();
  }
  return MakeFactory(scheme, frame_tree_node_id,
                     content::GlobalRenderFrameHostId());
}

void RegisterShellSubresourceURLLoaderFactories(
    int render_process_id,
    int render_frame_id,
    const std::optional<url::Origin>& request_initiator_origin,
    content::ContentBrowserClient::NonNetworkURLLoaderFactoryMap* factories) {
  if (!request_initiator_origin ||
      !request_initiator_origin->IsSameOriginWith(ShellOrigin())) {
    return;
  }
  content::RenderFrameHost* frame =
      content::RenderFrameHost::FromID(render_process_id, render_frame_id);
  if (!frame || frame->GetParentOrOuterDocument()) {
    return;
  }
  content::WebContents* contents = content::WebContents::FromRenderFrameHost(frame);
  if (!contents || !(IsShellContents(contents) || IsPendingShellDocument(contents))) {
    return;
  }
  const content::GlobalRenderFrameHostId id = frame->GetGlobalId();
  factories->emplace(kNativeScheme,
                     MakeFactory(kNativeScheme, content::FrameTreeNodeId(), id));
  if (!DevServerURL()) {
    factories->emplace(kShellScheme,
                       MakeFactory(kShellScheme, content::FrameTreeNodeId(), id));
  }
}

}
