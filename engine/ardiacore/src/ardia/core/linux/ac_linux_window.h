// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_LINUX_AC_LINUX_WINDOW_H_
#define ARDIA_CORE_LINUX_AC_LINUX_WINDOW_H_

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "ardia/core/linux/ac_linux_bridge.h"
#include "base/functional/callback.h"
#include "base/functional/callback_helpers.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/observer_list.h"
#include "base/observer_list_types.h"
#include "base/process/kill.h"
#include "base/timer/timer.h"
#include "base/values.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/web_modal/web_contents_modal_dialog_host.h"
#include "content/public/browser/keyboard_event_processing_result.h"
#include "content/public/browser/web_contents_delegate.h"
#include "content/public/browser/web_contents_observer.h"
#include "third_party/blink/public/mojom/page/draggable_region.mojom-forward.h"
#include "third_party/skia/include/core/SkRegion.h"
#include "ui/base/window_open_disposition.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/native_ui_types.h"
#include "ui/views/widget/widget_observer.h"

class Browser;
class BrowserWebContentsDelegate;
class BrowserUiController;
class BrowserWindow;
class BrowserWindowInterface;
class DesktopBrowserWindowCapabilities;
class ExclusiveAccessManager;
class Profile;
class UnloadController;

namespace chrome {
class BrowserCommandController;
}

namespace input {
struct NativeWebKeyboardEvent;
}

namespace views {
class View;
class WebView;
class Widget;
class WidgetDelegate;
}

namespace web_app {
class AppBrowserController;
}

namespace ardia::linux_host {

class LinuxBrowserWindow;
class LinuxWindow;

struct NativeViewParams {
  raw_ptr<LinuxWindow> window = nullptr;
  raw_ptr<content::WebContents> shell = nullptr;
  int view_id = 0;
  std::string manager;
};

class LinuxNativeView {
 public:
  virtual ~LinuxNativeView();
  virtual views::View* GetView() = 0;
  virtual void SetProps(const base::DictValue& props) = 0;
  virtual void PropsDidUpdate();
  virtual void FrameChanged(const gfx::Rect& frame);
  virtual void AttachedToWindow(LinuxWindow* window);
  virtual void Call(const CallContext& context,
                    std::string_view method,
                    base::ListValue args,
                    CallReply reply);
};

using NativeViewFactory = base::RepeatingCallback<std::unique_ptr<LinuxNativeView>(
    const NativeViewParams& params)>;
void RegisterNativeViewFactory(std::string_view manager,
                               NativeViewFactory factory);
LinuxNativeView* FindNativeView(int view_id);
int FindNativeViewId(const LinuxNativeView* view);

struct WindowOptions {
  WindowOptions();
  WindowOptions(const WindowOptions&);
  WindowOptions& operator=(const WindowOptions&);
  ~WindowOptions();

  std::string window_id;
  std::string profile;
  std::string chrome_window;
  std::string kind = "browser";
  std::u16string title;
  std::optional<gfx::Rect> bounds;
  std::optional<gfx::Size> minimum_size;
  bool focus = true;
  bool incognito = false;
};

class LinuxWindow : public TabStripModelObserver,
                    public views::WidgetObserver,
                    public web_modal::WebContentsModalDialogHost,
                    public content::WebContentsDelegate,
                    public content::WebContentsObserver {
 public:
  enum class Role { kApp, kChromeMade, kStray, kStandalone, kPopup };

  class Observer : public base::CheckedObserver {
   public:
    virtual void OnWindowTabInserted(LinuxWindow* window,
                                     content::WebContents* contents,
                                     content::WebContents* opener,
                                     std::string_view disposition) {}
    virtual void OnWindowTabRemoved(LinuxWindow* window,
                                    content::WebContents* contents) {}
    virtual void OnWindowTabActivated(LinuxWindow* window,
                                      content::WebContents* contents) {}
    virtual void OnWindowActivationChanged(LinuxWindow* window, bool active) {}
    virtual void OnWindowBoundsChanged(LinuxWindow* window,
                                       const gfx::Rect& bounds) {}
    virtual void OnWindowStateChanged(LinuxWindow* window) {}
    virtual void OnWindowShellReady(LinuxWindow* window) {}
    virtual void OnWindowCloseCancelled(LinuxWindow* window) {}
    virtual void OnWindowClosing(LinuxWindow* window) {}
  };

  using CloseRequestHandler = base::RepeatingCallback<bool(LinuxWindow*)>;
  using KeyHandler =
      base::RepeatingCallback<bool(LinuxWindow*,
                                   const input::NativeWebKeyboardEvent&,
                                   bool before_page)>;
  using DownloadsConfirmHandler = base::RepeatingCallback<
      void(LinuxWindow*, int count, base::OnceCallback<void(bool)> answer)>;
  using PasswordPromptSource =
      base::RepeatingCallback<std::optional<base::DictValue>(
          content::WebContents*)>;

  struct PendingOpen {
    std::optional<WindowOpenDisposition> disposition;
    base::WeakPtr<content::WebContents> source;
  };

  LinuxWindow(Role role, const gfx::Rect& bounds);
  LinuxWindow(const LinuxWindow&) = delete;
  LinuxWindow& operator=(const LinuxWindow&) = delete;
  ~LinuxWindow() override;

  static void AddObserver(Observer* observer);
  static void RemoveObserver(Observer* observer);
  static void SetCloseRequestHandler(CloseRequestHandler handler);
  static void SetKeyHandler(KeyHandler handler);
  static void SetDownloadsConfirmHandler(DownloadsConfirmHandler handler);
  static void SetPasswordPromptSource(PasswordPromptSource source);

  static const std::vector<LinuxWindow*>& All();
  static LinuxWindow* ForId(std::string_view window_id);
  static LinuxWindow* ForBrowser(const BrowserWindowInterface* browser);
  static LinuxWindow* ForWidget(const views::Widget* widget);
  static LinuxWindow* ForNativeWindow(gfx::NativeWindow window);
  static LinuxWindow* ForShell(const content::WebContents* shell);
  static LinuxWindow* ForTab(const content::WebContents* contents);
  static LinuxWindow* LastActive();

  static LinuxWindow* Open(const WindowOptions& options);
  static LinuxWindow* ClaimChromeMadeWindow(const std::string& token);
  static LinuxWindow* StandaloneWindowFor(Profile* profile);
  static LinuxWindow* HostingWindowFor(Profile* profile);
  static BrowserWindow* WindowForNewBrowser(Browser* browser);
  static void CloseAll();
  static void DestroyAll();

  Role role() const { return role_; }
  const std::string& window_id() const { return window_id_; }
  void set_window_id(const std::string& window_id) { window_id_ = window_id; }
  const std::string& chrome_token() const { return chrome_token_; }
  const std::string& kind() const { return kind_; }
  bool internal() const { return internal_; }
  void set_internal(bool internal) { internal_ = internal; }
  bool closing() const { return close_state_ == CloseState::kClosing; }
  bool can_close_widget() const { return widget_close_allowed_; }
  bool awaiting_app() const { return awaiting_app_; }

  views::Widget* widget() const { return widget_.get(); }
  gfx::NativeWindow native_window() const;
  gfx::NativeView native_view() const;
  views::View* contents_view() const { return contents_view_; }
  views::WebView* shell_view() const { return shell_view_; }
  content::WebContents* shell() const { return shell_.get(); }

  void AdoptShell(std::unique_ptr<content::WebContents> shell);
  void AnchorHostPage(content::WebContents* host);
  void ReleaseHostPage();
  bool anchors_host_page() const { return host_page_view_ != nullptr; }
  void RequestShellDocument();
  bool shell_ready() const { return shell_ready_; }

  void Show(bool focus);
  void ShowInactive();
  void Focus();
  void Minimize();
  void Maximize();
  void Restore();
  void ToggleMaximize();
  void BeginUserMove();
  void SetFullscreen(bool fullscreen);
  bool IsFullscreen() const;
  bool IsMaximized() const;
  bool IsMinimized() const;
  bool IsActive() const;
  bool IsVisible() const;
  void SetBounds(const gfx::Rect& bounds);
  gfx::Rect GetBounds() const;
  gfx::Rect GetRestoredBounds() const;
  void SetTitle(const std::u16string& title);
  const std::u16string& title() const { return title_; }
  void SetMinimumSize(const gfx::Size& size);
  gfx::Size minimum_size() const { return minimum_size_; }
  bool acted_fullscreen() const { return acted_fullscreen_; }
  void set_acted_fullscreen(bool acted) { acted_fullscreen_ = acted; }
  void CloseRequestedByUser();
  void Close();
  void QuitCancelled();

  Browser* BrowserFor(Profile* profile);
  Browser* ExistingBrowserFor(Profile* profile) const;
  std::vector<Browser*> browsers() const;
  void SetActiveProfile(Profile* profile);
  Profile* active_profile() const { return active_profile_; }
  void ShowProfile(const std::string& profile);
  void PrepareProfiles(const std::vector<std::string>& profiles);
  bool IsActiveBrowser(const Browser* browser) const;
  void NoteHostActivated(Browser* browser);
  bool IsUsersWindow();
  void RequestActivation(Browser* browser);
  BrowserWindow* HostChromeBrowser(Browser* browser);
  void BrowserWindowDestroyed(LinuxBrowserWindow* window);
  PendingOpen& pending_open() { return pending_open_; }
  void ConfirmCloseWithDownloads(int count,
                                 base::OnceCallback<void(bool)> callback);

  content::WebContents* OpenTab(const GURL& url,
                                Profile* profile,
                                bool foreground);
  void ActivateTab(content::WebContents* contents);
  std::vector<content::WebContents*> TabsForProfile(Profile* profile) const;
  std::vector<content::WebContents*> AllTabs() const;
  int ChromeWindowIdForProfile(Profile* profile) const;
  bool ExecuteChromeCommand(int command_id, Profile* profile);
  void AdoptTab(content::WebContents* contents);
  void PlaceTab(content::WebContents* contents, int index, bool pinned);
  content::WebContents* RestoreTab(const std::string& state,
                                   Profile* profile,
                                   bool foreground);
  content::WebContents* DuplicateTab(content::WebContents* source,
                                     Profile* profile,
                                     bool foreground);
  void NoteClosing(content::WebContents* contents);
  bool app_changing() const;

  void ActiveTabChanged(Browser* browser, content::WebContents* contents);
  void DevToolsDockChanged(content::WebContents* inspected,
                           content::WebContents* devtools);
  bool OfferPasswordSave(content::WebContents* contents);
  void FullscreenChanged(content::WebContents* contents, bool fullscreen);
  void ShowRequested(bool active);

  bool PreHandleKey(const input::NativeWebKeyboardEvent& event);
  bool HandleKey(content::WebContents* source,
                 const input::NativeWebKeyboardEvent& event);

  void AddNativeView(int view_id, views::View* view);
  void RemoveNativeView(int view_id);
  void PlaceNativeView(int view_id,
                       const std::optional<gfx::Rect>& frame,
                       const std::optional<std::optional<gfx::Rect>>& clip,
                       std::optional<bool> visible,
                       std::optional<double> order);
  bool HitsNativeView(const gfx::Point& point_in_contents) const;
  bool IsInDraggableRegion(const gfx::Point& point_in_contents) const;

  base::WeakPtr<LinuxWindow> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }

  void OnTabStripModelChanged(TabStripModel* tab_strip_model,
                              const TabStripModelChange& change,
                              const TabStripSelectionChange& selection) override;

  void OnWidgetActivationChanged(views::Widget* widget, bool active) override;
  void OnWidgetBoundsChanged(views::Widget* widget,
                             const gfx::Rect& new_bounds) override;
  void OnWidgetShowStateChanged(views::Widget* widget) override;
  void OnWidgetDestroying(views::Widget* widget) override;

  gfx::NativeView GetHostView() const override;
  gfx::Point GetDialogPosition(const gfx::Size& size) override;
  bool ShouldActivateDialog() const override;
  gfx::Size GetMaximumDialogSize() override;
  void AddObserver(web_modal::ModalDialogHostObserver* observer) override;
  void RemoveObserver(web_modal::ModalDialogHostObserver* observer) override;
  void NotifyPositionRequiresUpdate() override;

  content::WebContents* OpenURLFromTab(
      content::WebContents* source,
      const content::OpenURLParams& params,
      base::OnceCallback<void(content::NavigationHandle&)>
          navigation_handle_callback) override;
  content::KeyboardEventProcessingResult PreHandleKeyboardEvent(
      content::WebContents* source,
      const input::NativeWebKeyboardEvent& event) override;
  bool HandleKeyboardEvent(content::WebContents* source,
                           const input::NativeWebKeyboardEvent& event) override;
  void DraggableRegionsChanged(
      const std::vector<blink::mojom::DraggableRegionPtr>& regions,
      content::WebContents* contents) override;
  void CloseContents(content::WebContents* source) override;
  bool IsWebContentsCreationOverridden(
      content::RenderFrameHost* opener,
      content::SiteInstance* source_site_instance,
      content::mojom::WindowContainerType window_container_type,
      const GURL& opener_url,
      const std::string& frame_name,
      const GURL& target_url) override;

  void DidFirstVisuallyNonEmptyPaint() override;
  void PrimaryMainFrameRenderProcessGone(
      base::TerminationStatus status) override;
  void TitleWasSet(content::NavigationEntry* entry) override;

 private:
  enum class CloseState { kOpen, kAsking, kClosing };
  struct NativeViewSlot;

  void InitWidget(const gfx::Rect& bounds);
  void Reveal();
  void LayoutNativeViews();
  void ContinueClose();
  void ContinueCloseAttempt(int attempt);
  void OnBeforeUnloadAnswered(bool proceed);
  void CancelClose();
  void NotifyCloseCancelled();
  void CommitClose();
  void CloseWidget();
  int DownloadsCancelledByClose() const;
  void AddBrowser(Browser* browser);
  void ScheduleDialogPositionUpdate();
  void StopAwaitingApp();
  void AnnounceChromeMadeTab(base::WeakPtr<content::WebContents> contents,
                             int tries);
  void HandOffTab(content::WebContents* contents);
  void TabInserted(content::WebContents* contents,
                   content::WebContents* opener,
                   std::string_view disposition);
  void TabRemoved(content::WebContents* contents);
  void CloseIfEmptyLater(Profile* removed_profile);
  void OpenPopupWindow(content::WebContents* contents,
                       content::WebContents* opener);
  void TakePopupTab(base::WeakPtr<content::WebContents> contents);
  void UpdatePopupTitle();

  Role role_;
  std::string window_id_;
  std::string chrome_token_;
  std::string kind_ = "browser";
  std::u16string title_;
  gfx::Size minimum_size_;
  std::unique_ptr<views::WidgetDelegate> widget_delegate_;
  std::unique_ptr<views::Widget> widget_;
  raw_ptr<views::View> contents_view_ = nullptr;
  raw_ptr<views::WebView> shell_view_ = nullptr;
  raw_ptr<views::WebView> host_page_view_ = nullptr;
  std::unique_ptr<content::WebContents> shell_;
  base::ScopedClosureRunner shell_kept_visible_;
  bool shell_ready_ = false;
  bool revealed_ = false;
  bool reveal_focus_ = true;
  base::OneShotTimer reveal_timer_;
  SkRegion draggable_region_;
  std::map<int, std::unique_ptr<NativeViewSlot>> native_views_;
  std::map<Profile*, raw_ptr<Browser>> browsers_;
  raw_ptr<Profile> active_profile_ = nullptr;
  CloseState close_state_ = CloseState::kOpen;
  raw_ptr<Browser> asking_ = nullptr;
  int close_attempt_ = 0;
  bool widget_close_allowed_ = false;
  bool deletion_scheduled_ = false;
  bool internal_ = false;
  bool acted_fullscreen_ = false;
  bool fullscreen_for_tab_ = false;
  bool awaiting_app_ = false;
  bool show_inactive_requested_ = false;
  bool announced_ = false;
  base::WeakPtr<content::WebContents> chrome_active_;
  base::WeakPtr<content::WebContents> popup_tab_;
  base::WeakPtr<content::WebContents> popup_opener_;
  base::OneShotTimer awaiting_app_timer_;
  std::vector<base::WeakPtr<content::WebContents>> closing_tabs_;
  int host_changes_ = 0;
  PendingOpen pending_open_;
  base::ObserverList<web_modal::ModalDialogHostObserver> modal_observers_;
  bool dialog_position_update_scheduled_ = false;
  base::WeakPtrFactory<LinuxWindow> weak_factory_{this};
};

std::unique_ptr<BrowserWebContentsDelegate> CreateWebContentsDelegate(
    BrowserWindowInterface* browser,
    ExclusiveAccessManager& exclusive_access_manager,
    chrome::BrowserCommandController& command_controller,
    UnloadController& unload_controller,
    web_app::AppBrowserController* app_browser_controller,
    BrowserWindow& window,
    DesktopBrowserWindowCapabilities& capabilities,
    BrowserUiController& browser_ui_controller);

bool IsNotifyingTabStrip();
void ConfirmQuitWithDownloads(int count,
                              base::OnceCallback<void(bool)> callback);
void NotifyWindowsQuitCancelled();
const char* DispositionName(WindowOpenDisposition disposition);
std::string AppDisposition(std::string_view chrome_disposition);
std::optional<base::DictValue> PopupFeaturesOf(content::WebContents* contents);

}

#endif
