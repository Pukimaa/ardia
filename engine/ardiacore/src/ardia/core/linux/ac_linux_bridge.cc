// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/linux/ac_linux_bridge.h"

#include <deque>
#include <utility>

#include "ardia/core/linux/ac_linux_host.h"
#include "base/check.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/no_destructor.h"
#include "base/strings/strcat.h"
#include "base/strings/utf_string_conversions.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"

namespace ardia::linux_host {

namespace {

constexpr size_t kMaxQueuedEvents = 4096;

std::string Serialize(const base::DictValue& reply) {
  std::optional<std::string> json = base::WriteJson(reply);
  if (json) {
    return *std::move(json);
  }
  return R"({"error":{"code":"ERR_UNSERIALIZABLE","message":"the native reply is not JSON"}})";
}

struct QueuedCall {
  std::u16string method;
  base::ListValue args;
};

std::deque<QueuedCall>& Queued() {
  static base::NoDestructor<std::deque<QueuedCall>> queued;
  return *queued;
}

bool& FlushScheduled() {
  static bool scheduled = false;
  return scheduled;
}

content::WebContents* RealmFor(content::WebContents* shell) {
  if (shell && IsHostPage(shell)) {
    return shell;
  }
  return HostPage();
}

void RunInRealm(content::WebContents* realm,
                std::u16string method,
                base::ListValue args);

void FlushQueued() {
  FlushScheduled() = false;
  content::WebContents* realm = HostPage();
  if (!realm) {
    return;
  }
  std::deque<QueuedCall> calls;
  calls.swap(Queued());
  for (QueuedCall& call : calls) {
    RunInRealm(realm, std::move(call.method), std::move(call.args));
  }
}

void Enqueue(std::u16string method, base::ListValue args) {
  if (Queued().size() >= kMaxQueuedEvents) {
    Queued().pop_front();
  }
  Queued().push_back({std::move(method), std::move(args)});
  if (!FlushScheduled()) {
    FlushScheduled() = true;
    WhenHostReady(base::BindOnce(&FlushQueued));
  }
}

void RunInRealm(content::WebContents* realm,
                std::u16string method,
                base::ListValue args) {
  content::RenderFrameHost* frame =
      realm ? realm->GetPrimaryMainFrame() : nullptr;
  if (!frame || !frame->IsRenderFrameLive() || !HostStarted() ||
      !IsShellFrame(frame) || !Queued().empty()) {
    Enqueue(std::move(method), std::move(args));
    return;
  }
  frame->ExecuteJavaScriptMethod(u"window", method, std::move(args),
                                 content::RenderFrameHost::JavaScriptResultCallback());
}

}

CallReply::CallReply(Sink sink) : sink_(std::move(sink)) {}

CallReply::CallReply(CallReply&&) = default;

CallReply& CallReply::operator=(CallReply&& other) {
  if (this != &other) {
    if (sink_) {
      Error("ERR_NO_REPLY", "the native call was replaced before it replied");
    }
    sink_ = std::move(other.sink_);
  }
  return *this;
}

CallReply::~CallReply() {
  if (sink_) {
    Error("ERR_NO_REPLY", "the native call ended without a reply");
  }
}

void CallReply::Ok(base::Value value) {
  if (!sink_) {
    return;
  }
  base::DictValue reply;
  reply.Set("ok", std::move(value));
  std::move(sink_).Run(Serialize(reply));
}

void CallReply::Ok() {
  Ok(base::Value());
}

void CallReply::Error(std::string_view code, std::string_view message) {
  if (!sink_) {
    return;
  }
  base::DictValue error;
  error.Set("code", code);
  error.Set("message", message);
  base::DictValue reply;
  reply.Set("error", std::move(error));
  std::move(sink_).Run(Serialize(reply));
}

base::DictValue LinuxNativeModule::Constants() const {
  return base::DictValue();
}

Bridge& Bridge::Get() {
  static Bridge* bridge = new Bridge();
  return *bridge;
}

Bridge::Bridge() = default;
Bridge::~Bridge() = default;

void Bridge::Register(std::unique_ptr<LinuxNativeModule> module) {
  if (!module) {
    return;
  }
  std::string name(module->name());
  modules_[std::move(name)] = std::move(module);
}

LinuxNativeModule* Bridge::Find(std::string_view name) const {
  auto it = modules_.find(name);
  return it == modules_.end() ? nullptr : it->second.get();
}

base::DictValue Bridge::Constants() const {
  base::DictValue all;
  for (const auto& [name, module] : modules_) {
    all.Set(name, module->Constants());
  }
  return all;
}

void Bridge::Dispatch(const CallContext& context,
                      std::string_view module,
                      std::string_view method,
                      std::string_view args_json,
                      CallReply::Sink sink) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  CallReply reply(std::move(sink));
  LinuxNativeModule* target = Find(module);
  if (!target) {
    reply.Error("ERR_MODULE_NOT_FOUND",
                base::StrCat({"no native module ", module}));
    return;
  }
  base::ListValue args;
  if (!args_json.empty()) {
    std::optional<base::ListValue> parsed =
        base::JSONReader::ReadList(args_json, base::JSON_PARSE_RFC);
    if (!parsed) {
      reply.Error("ERR_INVALID_ARGUMENTS",
                  base::StrCat({module, ".", method,
                                ": the arguments are not a JSON array"}));
      return;
    }
    args = *std::move(parsed);
  }
  target->Call(context, method, std::move(args), std::move(reply));
}

void Bridge::Emit(std::string_view module,
                  std::string_view event,
                  base::Value payload) {
  EmitTo(nullptr, module, event, std::move(payload));
}

void Bridge::EmitTo(content::WebContents* shell,
                    std::string_view module,
                    std::string_view event,
                    base::Value payload) {
  base::ListValue args;
  args.Append(module);
  args.Append(event);
  args.Append(std::move(payload));
  RunInRealm(RealmFor(shell), u"__ardiaNativeEmit", std::move(args));
}

void Bridge::EmitView(content::WebContents* shell,
                      int view_id,
                      std::string_view event,
                      base::Value payload) {
  base::ListValue args;
  args.Append(view_id);
  args.Append(event);
  args.Append(std::move(payload));
  RunInRealm(RealmFor(shell), u"__ardiaNativeViewEmit", std::move(args));
}

}
