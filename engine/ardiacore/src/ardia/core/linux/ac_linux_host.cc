// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/linux/ac_linux_host.h"

#include <algorithm>
#include <cstdlib>
#include <map>
#include <memory>
#include <optional>
#include <utility>
#include <vector>

#include "ardia/core/ac_extension_shortcuts.h"
#include "ardia/core/ac_extension_view.h"
#include "ardia/core/ac_external_apps.h"
#include "ardia/core/ac_hooks.h"
#include "ardia/core/ac_host_visibility.h"
#include "ardia/core/ac_installed_bubble.h"
#include "ardia/core/ac_lifetime.h"
#include "ardia/core/ac_main_delegate.h"
#include "ardia/core/ac_page_channel.h"
#include "ardia/core/ac_permissions.h"
#include "ardia/core/ac_picture_in_picture.h"
#include "ardia/core/ac_video_upscaling.h"
#include "ardia/core/linux/ac_linux_bridge.h"
#include "ardia/core/linux/ac_linux_scheme.h"
#include "ardia/core/linux/ac_linux_window.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/base_paths.h"
#include "base/strings/strcat.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "base/values.h"
#include "chrome/browser/apps/platform_apps/shortcut_manager.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_delegate.h"
#include "content/public/browser/web_contents_observer.h"
#include "third_party/blink/public/mojom/devtools/console_message.mojom.h"
#include "third_party/blink/public/mojom/window_features/window_features.mojom.h"
#include "ui/base/page_transition_types.h"
#include "url/gurl.h"

int g_ardia_disk_space_check_seconds = 0;
bool g_ardia_bluetooth_poll_on_demand = false;

namespace ardia::linux_host {

namespace {

constexpr char kWindowFramePrefix[] = "ardia-window-";
constexpr char kWindowDocumentPath[] = "window.html";
constexpr char kHostDocumentPath[] = "index.html";
constexpr char kPageScriptEnv[] = "ARDIA_PAGE_SCRIPT";
constexpr char kShellConsoleEnv[] = "ARDIA_SHELL_CONSOLE";
constexpr base::TimeDelta kReloadDelay = base::Milliseconds(500);
constexpr int kMaxReloadsInARow = 5;

LaunchSettings& Settings() {
  static base::NoDestructor<LaunchSettings> settings;
  return *settings;
}

class ShellHostPage : public content::WebContentsDelegate,
                      public content::WebContentsObserver,
                      public LinuxWindow::Observer {
 public:
  ShellHostPage() { LinuxWindow::AddObserver(this); }
  ShellHostPage(const ShellHostPage&) = delete;
  ShellHostPage& operator=(const ShellHostPage&) = delete;
  ~ShellHostPage() override { LinuxWindow::RemoveObserver(this); }

  content::WebContents* contents() const { return contents_.get(); }
  Profile* profile() const { return profile_; }
  bool ready() const { return ready_; }

  void Start(Profile* profile) {
    if (contents_ || !profile) {
      return;
    }
    profile_ = profile;
    content::WebContents::CreateParams params(profile);
    contents_ = content::WebContents::Create(params);
    contents_->SetDelegate(this);
    Observe(contents_.get());
    kept_awake_ =
        contents_->IncrementCapturerCount(gfx::Size(), false, true, false);
    Load();
  }

  void Stop() {
    ready_ = false;
    Observe(nullptr);
    pending_windows_.clear();
    pending_popups_.clear();
    for (LinuxWindow* window : LinuxWindow::All()) {
      window->ReleaseHostPage();
    }
    kept_awake_.RunAndReset();
    contents_.reset();
  }

  void WhenReady(base::OnceClosure ready) {
    if (ready_) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, std::move(ready));
      return;
    }
    waiters_.push_back(std::move(ready));
  }

  void OpenDocument(LinuxWindow* window) {
    if (!window || window->window_id().empty()) {
      return;
    }
    Anchor(window);
    if (!ready_) {
      if (!std::ranges::contains(pending_windows_, window->window_id())) {
        pending_windows_.push_back(window->window_id());
      }
      return;
    }
    content::RenderFrameHost* frame = contents_->GetPrimaryMainFrame();
    if (!frame || !frame->IsRenderFrameLive()) {
      pending_windows_.push_back(window->window_id());
      return;
    }
    base::ListValue args;
    args.Append(window->window_id());
    frame->ExecuteJavaScriptMethod(
        u"window", u"__ardiaNativeOpenWindowDocument", std::move(args),
        content::RenderFrameHost::JavaScriptResultCallback());
  }

  bool IsPendingDocument(const content::WebContents* contents) const {
    return pending_popups_.contains(contents);
  }

  void WebContentsCreated(content::WebContents* source_contents,
                          const content::GlobalRenderFrameHostId& opener_id,
                          const std::string& frame_name,
                          const GURL& target_url,
                          content::WebContents* new_contents) override {
    if (source_contents != contents_.get() ||
        !base::StartsWith(frame_name, kWindowFramePrefix)) {
      return;
    }
    pending_popups_[new_contents] =
        frame_name.substr(std::string_view(kWindowFramePrefix).size());
  }

  content::WebContents* AddNewContents(
      content::WebContents* source,
      std::unique_ptr<content::WebContents> new_contents,
      const GURL& target_url,
      WindowOpenDisposition disposition,
      const blink::mojom::WindowFeatures& window_features,
      bool user_gesture,
      bool* was_blocked) override {
    auto it = pending_popups_.find(new_contents.get());
    if (it == pending_popups_.end()) {
      return nullptr;
    }
    const std::string window_id = it->second;
    pending_popups_.erase(it);
    LinuxWindow* window = LinuxWindow::ForId(window_id);
    const GURL expected = ShellURL(kWindowDocumentPath);
    if (!window || target_url.scheme() != expected.scheme() ||
        target_url.host() != expected.host() ||
        target_url.path() != expected.path()) {
      return nullptr;
    }
    content::WebContents* raw = new_contents.get();
    window->AdoptShell(std::move(new_contents));
    return raw;
  }

  content::WebContents* OpenURLFromTab(
      content::WebContents* source,
      const content::OpenURLParams& params,
      base::OnceCallback<void(content::NavigationHandle&)>
          navigation_handle_callback) override {
    return nullptr;
  }

  void CloseContents(content::WebContents* source) override {}

  bool DidAddMessageToConsole(content::WebContents* source,
                              blink::mojom::ConsoleMessageLevel log_level,
                              const std::u16string& message,
                              int32_t line_no,
                              const std::u16string& source_id) override {
    if (!getenv(kShellConsoleEnv)) {
      return false;
    }
    LOG(WARNING) << "[ardia-shell] " << source_id << ":" << line_no << " "
                 << message;
    return true;
  }

  void DOMContentLoaded(content::RenderFrameHost* frame) override {
    if (!frame->IsInPrimaryMainFrame() || !IsShellFrame(frame)) {
      return;
    }
    ready_ = true;
    reloads_in_a_row_ = 0;
    std::vector<std::string> windows;
    windows.swap(pending_windows_);
    for (const std::string& window_id : windows) {
      if (LinuxWindow* window = LinuxWindow::ForId(window_id)) {
        OpenDocument(window);
      }
    }
    std::vector<base::OnceClosure> waiters;
    waiters.swap(waiters_);
    for (base::OnceClosure& waiter : waiters) {
      std::move(waiter).Run();
    }
  }

  void PrimaryMainFrameRenderProcessGone(
      base::TerminationStatus status) override {
    ready_ = false;
    LOG(ERROR) << "[ardiacore] the shell's renderer went away ("
               << static_cast<int>(status) << "); reloading it";
    if (++reloads_in_a_row_ > kMaxReloadsInARow) {
      return;
    }
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&ShellHostPage::Reload, weak_factory_.GetWeakPtr()),
        kReloadDelay);
  }

  void OnWindowClosing(LinuxWindow* window) override {
    if (!window->anchors_host_page()) {
      return;
    }
    window->ReleaseHostPage();
    for (LinuxWindow* other : LinuxWindow::All()) {
      if (other != window && other->role() == LinuxWindow::Role::kApp &&
          !other->closing() && !other->can_close_widget()) {
        Anchor(other);
        return;
      }
    }
  }

 private:
  void Load() {
    content::NavigationController::LoadURLParams load(
        ShellURL(kHostDocumentPath));
    load.transition_type = ui::PAGE_TRANSITION_AUTO_TOPLEVEL;
    contents_->GetController().LoadURLWithParams(load);
  }

  void Reload() {
    if (!contents_) {
      return;
    }
    for (LinuxWindow* window : LinuxWindow::All()) {
      if (window->role() == LinuxWindow::Role::kApp &&
          !window->window_id().empty() &&
          !std::ranges::contains(pending_windows_, window->window_id())) {
        pending_windows_.push_back(window->window_id());
      }
    }
    Load();
  }

  void Anchor(LinuxWindow* window) {
    if (!contents_) {
      return;
    }
    for (LinuxWindow* other : LinuxWindow::All()) {
      if (other->anchors_host_page() && !other->closing() &&
          !other->can_close_widget()) {
        return;
      }
    }
    window->AnchorHostPage(contents_.get());
  }

  std::unique_ptr<content::WebContents> contents_;
  raw_ptr<Profile> profile_ = nullptr;
  base::ScopedClosureRunner kept_awake_;
  bool ready_ = false;
  int reloads_in_a_row_ = 0;
  std::vector<base::OnceClosure> waiters_;
  std::vector<std::string> pending_windows_;
  std::map<const content::WebContents*, std::string> pending_popups_;
  base::WeakPtrFactory<ShellHostPage> weak_factory_{this};
};

ShellHostPage*& Host() {
  static ShellHostPage* host = nullptr;
  return host;
}

bool& Started() {
  static bool started = false;
  return started;
}

base::FilePath PageScriptPath() {
  if (const char* path = getenv(kPageScriptEnv); path && *path) {
    return base::FilePath(path);
  }
  base::FilePath exe_dir;
  if (!base::PathService::Get(base::DIR_EXE, &exe_dir)) {
    return base::FilePath();
  }
  return exe_dir.Append(FILE_PATH_LITERAL("resources"))
      .Append(FILE_PATH_LITERAL("page_script.js"));
}

void LoadPageScript() {
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_BLOCKING},
      base::BindOnce([] {
        std::string script;
        const base::FilePath path = PageScriptPath();
        if (path.empty() || !base::ReadFileToString(path, &script)) {
          LOG(ERROR) << "[ardiacore] no page script at " << path;
          script.clear();
        }
        return script;
      }),
      base::BindOnce([](std::string script) {
        if (!script.empty()) {
          ardiacore::SetPageScript(script);
        }
      }));
}

void StartHostPage(Profile* profile) {
  if (!Host() || !profile) {
    if (!profile) {
      LOG(ERROR) << "[ardiacore] no profile for the shell";
    }
    return;
  }
  Host()->Start(profile);
}

void InstallEngineHooks() {
  g_ardia_browser_window_factory = &LinuxWindow::WindowForNewBrowser;
  g_ardia_create_web_contents_delegate = &CreateWebContentsDelegate;
  g_ardia_viewless_browsers = true;
  g_ardia_reserved_global_accelerator = &ardiacore::IsReservedGlobalAccelerator;
  g_ardia_global_shortcuts_resumed = &ardiacore::GlobalShortcutsResumed;
  g_ardia_history_eligible = [](content::WebContents* contents) {
    BrowserWindowInterface* browser =
        GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
    LinuxWindow* window = browser ? LinuxWindow::ForBrowser(browser) : nullptr;
    return !window || !window->internal();
  };
}

}

const LaunchSettings& Launch() {
  return Settings();
}

void SetLaunchSettings(const LaunchSettings& settings) {
  Settings() = settings;
}

bool Background() {
  return Settings().background;
}

std::vector<std::string> TakeLaunchURLs() {
  return std::exchange(Settings().launch_urls, {});
}

void PrepareBrowserProcess() {
  InstallEngineHooks();
  ardiacore::InstallExtensionInstalledHook();
  ardiacore::InstallActionPopupHook();
  AppShortcutManager::SuppressShortcutsForTesting();
  ardiacore::SetLifetimeCallbacks({
      .quit_cancelled = base::BindRepeating([] {
        LOG(WARNING) << "[ardiacore] quit cancelled";
        base::DictValue event;
        event.Set("type", "quitCancelled");
        Bridge::Get().Emit("ArdiaShell", "onAppEvent",
                           base::Value(std::move(event)));
      }),
  });
  ardiacore::SetEngineCallbacks({
      .started = base::BindOnce(&StartHost),
      .shutting_down = base::BindOnce(&ShutDownHost),
  });
}

void StartHost() {
  if (Started()) {
    return;
  }
  Started() = true;
  InstallEngineHooks();
  content::RenderFrameHost::AllowInjectingJavaScript();
  RegisterAllModules(Bridge::Get());
  ardiacore::InstallPermissionPrompts();
  ardiacore::InstallExternalAppPrompts();
  ardiacore::StartPictureInPictureObserver();
  ardiacore::StartHostVisibility();
  ardiacore::StartVideoUpscaling();
  LoadPageScript();
  Host() = new ShellHostPage();
  ProfileManager* manager = g_browser_process->profile_manager();
  if (Profile* loaded = ProfileManager::GetLastUsedProfileIfLoaded()) {
    StartHostPage(loaded->GetOriginalProfile());
    return;
  }
  manager->CreateProfileAsync(
      manager->user_data_dir().Append(FILE_PATH_LITERAL("Default")),
      base::BindOnce(&StartHostPage));
}

void ShutDownHost() {
  ardiacore::CloseAllExtensionViews();
  if (ShellHostPage* host = Host()) {
    host->Stop();
  }
  LinuxWindow::DestroyAll();
  delete Host();
  Host() = nullptr;
  Started() = false;
}

bool HostStarted() {
  return Started();
}

content::WebContents* HostPage() {
  return Host() ? Host()->contents() : nullptr;
}

Profile* HostProfile() {
  return Host() ? Host()->profile() : nullptr;
}

bool IsHostPage(const content::WebContents* contents) {
  return contents && contents == HostPage();
}

bool IsShellContents(const content::WebContents* contents) {
  return contents && (IsHostPage(contents) || LinuxWindow::ForShell(contents));
}

bool IsPendingShellDocument(const content::WebContents* contents) {
  return contents && Host() && Host()->IsPendingDocument(contents);
}

bool IsShellFrame(content::RenderFrameHost* frame) {
  if (!frame || frame->GetParentOrOuterDocument()) {
    return false;
  }
  content::WebContents* contents = content::WebContents::FromRenderFrameHost(frame);
  if (!contents || contents->GetPrimaryMainFrame() != frame ||
      !(IsShellContents(contents) || IsPendingShellDocument(contents))) {
    return false;
  }
  return frame->GetLastCommittedOrigin().IsSameOriginWith(ShellOrigin());
}

void OpenWindowDocument(LinuxWindow* window) {
  if (Host()) {
    Host()->OpenDocument(window);
  }
}

void WhenHostReady(base::OnceClosure ready) {
  if (Host()) {
    Host()->WhenReady(std::move(ready));
  }
}

GURL ShellURL(std::string_view path) {
  if (std::optional<std::string> dev = DevServerURL()) {
    return GURL(*dev).Resolve(path);
  }
  return GURL(base::StrCat({kShellScheme, "://", kShellHost, "/", path}));
}

std::string WindowDocumentFrameName(std::string_view window_id) {
  return base::StrCat({kWindowFramePrefix, window_id});
}

}
