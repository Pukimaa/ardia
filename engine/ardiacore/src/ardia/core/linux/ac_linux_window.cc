// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/linux/ac_linux_window.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <set>
#include <utility>

#include "ardia/core/ac_autofill_prompt.h"
#include "ardia/core/ac_contents_background.h"
#include "ardia/core/ac_desktop_capture.h"
#include "ardia/core/ac_extension_shortcuts.h"
#include "ardia/core/ac_fake_media.h"
#include "ardia/core/ac_installed_bubble.h"
#include "ardia/core/ac_lifetime.h"
#include "ardia/core/ac_page_channel.h"
#include "ardia/core/ac_password_prompt.h"
#include "ardia/core/ac_autofill_trigger.h"
#include "ardia/core/linux/ac_linux_host.h"
#include "ardia/core/linux/ac_linux_tab.h"
#include "base/auto_reset.h"
#include "base/base64.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/pickle.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/cancelable_task_tracker.h"
#include "base/task/single_thread_task_runner.h"
#include "base/uuid.h"
#include "url/url_constants.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_model.h"
#include "third_party/blink/public/common/input/web_input_event.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/devtools/devtools_ui_controller.h"
#include "chrome/browser/download/download_core_service.h"
#include "chrome/browser/download/download_core_service_factory.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/profiles/nuke_profile_directory_utils.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/tab_list/tab_removed_reason.h"
#include "chrome/browser/themes/theme_service.h"
#include "chrome/browser/ui/autofill/autofill_bubble_handler.h"
#include "chrome/browser/ui/autofill/save_address_bubble_controller.h"
#include "chrome/browser/ui/autofill/update_address_bubble_controller.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_active_state_manager/browser_active_state_manager.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_tabrestore.h"
#include "chrome/browser/ui/browser_web_contents_delegate/browser_web_contents_delegate.h"
#include "chrome/browser/ui/browser_window.h"
#include "chrome/browser/ui/browser_window/public/browser_window_features.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/browser_window/public/create_browser_window.h"
#include "chrome/browser/ui/browser_window/public/desktop_browser_window_capabilities.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_context.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_manager.h"
#include "chrome/browser/ui/exclusive_access/fullscreen_controller.h"
#include "chrome/browser/ui/find_bar/find_bar.h"
#include "chrome/browser/ui/find_bar/find_bar_controller.h"
#include "chrome/browser/ui/location_bar/location_bar.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "chrome/browser/ui/passwords/passwords_model_delegate.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/unload_controller.h"
#include "chrome/browser/ui/views/bubble_anchor_util_views.h"
#include "chrome/browser/ui/views/exclusive_access/exclusive_access_bubble_views.h"
#include "chrome/browser/ui/views/exclusive_access/exclusive_access_bubble_views_context.h"
#include "chrome/browser/ui/views/eye_dropper/eye_dropper.h"
#include "chrome/browser/ui/views/frame/contents_container_view.h"
#include "chrome/browser/ui/views/interaction/browser_elements_views_impl.h"
#include "components/input/native_web_keyboard_event.h"
#include "components/sessions/core/serialized_navigation_entry.h"
#include "components/sessions/core/serialized_user_agent_override.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/eye_dropper.h"
#include "content/public/browser/eye_dropper_listener.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_user_data.h"
#include "third_party/blink/public/mojom/page/draggable_region.mojom.h"
#include "third_party/blink/public/mojom/window_features/window_features.mojom.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/accelerators/accelerator.h"
#include "ui/base/hit_test.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/mojom/window_show_state.mojom.h"
#include "ui/base/ui_base_features.h"
#include "ui/color/color_provider_manager.h"
#include "ui/content_accelerators/accelerator_util.h"
#include "ui/display/screen.h"
#include "ui/display/types/display_constants.h"
#include "ui/events/event_constants.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/gfx/geometry/insets.h"
#include "ui/gfx/range/range.h"
#include "ui/native_theme/native_theme.h"
#include "ui/views/controls/native/native_view_host.h"
#include "ui/views/controls/webview/unhandled_keyboard_event_handler.h"
#include "ui/views/controls/webview/webview.h"
#include "ui/views/view.h"
#include "ui/views/view_utils.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_delegate.h"
#include "ui/views/window/client_view.h"
#include "ui/views/window/frame_view.h"

namespace ardia::linux_host {

namespace {

constexpr int kResizeBorder = 5;
constexpr int kResizeCorner = 16;
constexpr gfx::Size kDefaultWindowSize(1360, 860);
constexpr gfx::Size kSmallWindowSize(800, 600);
constexpr base::TimeDelta kRevealTimeout = base::Milliseconds(600);
constexpr base::TimeDelta kShellMissingTimeout = base::Seconds(2);
constexpr base::TimeDelta kAwaitAppTimeout = base::Seconds(20);
constexpr base::TimeDelta kAnnounceRetry = base::Milliseconds(25);
constexpr base::TimeDelta kClosingMemory = base::Seconds(3);
constexpr SkColor kWindowBackground = SkColorSetRGB(0xF4, 0xF4, 0xF5);

std::vector<LinuxWindow*>& Windows() {
  static base::NoDestructor<std::vector<LinuxWindow*>> windows;
  return *windows;
}

std::vector<std::unique_ptr<LinuxWindow>>& OwnedWindows() {
  static base::NoDestructor<std::vector<std::unique_ptr<LinuxWindow>>> owned;
  return *owned;
}

std::vector<base::WeakPtr<LinuxWindow>>& ActivationOrder() {
  static base::NoDestructor<std::vector<base::WeakPtr<LinuxWindow>>> order;
  return *order;
}

base::ObserverList<LinuxWindow::Observer>& WindowObservers() {
  static base::NoDestructor<base::ObserverList<LinuxWindow::Observer>> list;
  return *list;
}

LinuxWindow::CloseRequestHandler& CloseRequests() {
  static base::NoDestructor<LinuxWindow::CloseRequestHandler> handler;
  return *handler;
}

LinuxWindow::KeyHandler& Keys() {
  static base::NoDestructor<LinuxWindow::KeyHandler> handler;
  return *handler;
}

LinuxWindow::DownloadsConfirmHandler& DownloadsConfirms() {
  static base::NoDestructor<LinuxWindow::DownloadsConfirmHandler> handler;
  return *handler;
}

LinuxWindow::PasswordPromptSource& PasswordPrompts() {
  static base::NoDestructor<LinuxWindow::PasswordPromptSource> source;
  return *source;
}

std::map<std::string, base::WeakPtr<LinuxWindow>>& ChromeMadeWindows() {
  static base::NoDestructor<std::map<std::string, base::WeakPtr<LinuxWindow>>>
      windows;
  return *windows;
}

std::map<Profile*, base::WeakPtr<LinuxWindow>>& StandaloneWindows() {
  static base::NoDestructor<std::map<Profile*, base::WeakPtr<LinuxWindow>>>
      windows;
  return *windows;
}

base::WeakPtr<LinuxWindow>& LastUsersWindow() {
  static base::NoDestructor<base::WeakPtr<LinuxWindow>> window;
  return *window;
}

int g_tab_strip_notifying = 0;

bool ProfileUnusable(Profile* profile) {
  return !profile || IsProfileGoing(profile) ||
         IsProfileDirectoryMarkedForDeletion(profile->GetPath());
}

void NoteActivated(LinuxWindow* window) {
  auto& order = ActivationOrder();
  std::erase_if(order, [&](const base::WeakPtr<LinuxWindow>& w) {
    return !w || w.get() == window;
  });
  order.insert(order.begin(), window->GetWeakPtr());
}

std::vector<LinuxWindow*> WindowsInActivationOrder() {
  std::vector<LinuxWindow*> ordered;
  for (const base::WeakPtr<LinuxWindow>& window : ActivationOrder()) {
    if (window) {
      ordered.push_back(window.get());
    }
  }
  for (LinuxWindow* window : Windows()) {
    if (!std::ranges::contains(ordered, window)) {
      ordered.push_back(window);
    }
  }
  return ordered;
}

class TabOpenInfo : public content::WebContentsUserData<TabOpenInfo> {
 public:
  ~TabOpenInfo() override = default;

  std::optional<WindowOpenDisposition> disposition;
  base::WeakPtr<content::WebContents> source;
  std::optional<base::DictValue> popup_features;

 private:
  friend class content::WebContentsUserData<TabOpenInfo>;
  explicit TabOpenInfo(content::WebContents* contents)
      : content::WebContentsUserData<TabOpenInfo>(*contents) {}
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(TabOpenInfo);

void NoteOpen(content::WebContents* contents,
              WindowOpenDisposition disposition,
              content::WebContents* source) {
  TabOpenInfo::CreateForWebContents(contents);
  TabOpenInfo* info = TabOpenInfo::FromWebContents(contents);
  info->disposition = disposition;
  info->source = source ? source->GetWeakPtr() : nullptr;
}

std::optional<WindowOpenDisposition> TakeOpenDisposition(
    content::WebContents* contents) {
  TabOpenInfo* info = TabOpenInfo::FromWebContents(contents);
  if (!info) {
    return std::nullopt;
  }
  return std::exchange(info->disposition, std::nullopt);
}

content::WebContents* OpenSourceOf(content::WebContents* contents) {
  TabOpenInfo* info = TabOpenInfo::FromWebContents(contents);
  return info ? info->source.get() : nullptr;
}

void CloseBlankTabsBeforeWindowCloses(Browser* browser) {
  TabStripModel* model = browser->GetTabStripModel();
  if (IsNotifyingTabStrip() || !model) {
    return;
  }
  for (int i = model->count() - 1; i >= 0; --i) {
    if (TabOnlyShowedBlank(model->GetWebContentsAt(i))) {
      model->DetachAndDeleteWebContentsAt(i);
    }
  }
}

void ActivateExclusively(Browser* browser) {
  if (browser->IsDeleteScheduled()) {
    return;
  }
  for (LinuxWindow* window : Windows()) {
    for (Browser* other : window->browsers()) {
      if (other != browser) {
        BrowserActiveStateManager::From(other)->DidBecomeInactive();
      }
    }
  }
  BrowserActiveStateManager* state = BrowserActiveStateManager::From(browser);
  if (GlobalBrowserCollection::GetInstance()->GetLastActiveBrowser() != browser ||
      ProfileManager::GetLastUsedProfileIfLoaded() != browser->GetProfile()) {
    state->DidBecomeInactive();
  }
  state->DidBecomeActive();
}

const char* BrowserTypeName(BrowserWindowInterface::Type type) {
  switch (type) {
    case BrowserWindowInterface::TYPE_NORMAL:
      return "normal";
    case BrowserWindowInterface::TYPE_POPUP:
      return "popup";
    case BrowserWindowInterface::TYPE_APP:
      return "app";
    case BrowserWindowInterface::TYPE_DEVTOOLS:
      return "devtools";
    case BrowserWindowInterface::TYPE_APP_POPUP:
      return "app_popup";
    case BrowserWindowInterface::TYPE_PICTURE_IN_PICTURE:
      return "picture_in_picture";
    default:
      return "other";
  }
}

std::string ProfileKey(Profile* profile) {
  return profile ? ProfileName(profile) : std::string();
}

}

struct LinuxWindow::NativeViewSlot {
  raw_ptr<views::View> container = nullptr;
  raw_ptr<views::View> view = nullptr;
  gfx::Rect frame;
  std::optional<gfx::Rect> clip;
  bool visible = true;
  double order = 0;
};

class ShellContentsView : public views::View {
  METADATA_HEADER(ShellContentsView, views::View)

 public:
  ShellContentsView() = default;
  ShellContentsView(const ShellContentsView&) = delete;
  ShellContentsView& operator=(const ShellContentsView&) = delete;
  ~ShellContentsView() override = default;

  void set_shell_view(views::View* shell_view) {
    shell_view_ = shell_view;
    InvalidateLayout();
  }

  void set_minimum(const gfx::Size& minimum) { minimum_ = minimum; }

  void set_host_page_view(views::View* host_page_view) {
    host_page_view_ = host_page_view;
    InvalidateLayout();
  }

  void Layout(PassKey) override {
    if (shell_view_) {
      shell_view_->SetBoundsRect(GetLocalBounds());
    }
    if (host_page_view_) {
      host_page_view_->SetBoundsRect(GetLocalBounds());
    }
  }

  gfx::Size GetMinimumSize() const override { return minimum_; }

 private:
  raw_ptr<views::View> shell_view_ = nullptr;
  raw_ptr<views::View> host_page_view_ = nullptr;
  gfx::Size minimum_;
};

BEGIN_METADATA(ShellContentsView)
END_METADATA

class ShellFrameView : public views::FrameView {
  METADATA_HEADER(ShellFrameView, views::FrameView)

 public:
  ShellFrameView(views::Widget* widget, base::WeakPtr<LinuxWindow> window)
      : widget_(widget), window_(std::move(window)) {}
  ShellFrameView(const ShellFrameView&) = delete;
  ShellFrameView& operator=(const ShellFrameView&) = delete;
  ~ShellFrameView() override = default;

  gfx::Rect GetBoundsForClientView() const override { return bounds(); }

  gfx::Rect GetWindowBoundsForClientBounds(
      const gfx::Rect& client_bounds) const override {
    return client_bounds;
  }

  int NonClientHitTest(const gfx::Point& point) override {
    if (!bounds().Contains(point)) {
      return HTNOWHERE;
    }
    const bool can_resize = widget_->widget_delegate() &&
                            widget_->widget_delegate()->CanResize() &&
                            !widget_->IsMaximized() &&
                            !widget_->IsFullscreen();
    if (can_resize) {
      const int edge = GetHTComponentForFrame(
          point, gfx::Insets(kResizeBorder), kResizeCorner, kResizeCorner, true);
      if (edge != HTNOWHERE) {
        return edge;
      }
    }
    if (window_ && window_->IsInDraggableRegion(point) &&
        !window_->HitsNativeView(point)) {
      return HTCAPTION;
    }
    return HTCLIENT;
  }

  void GetWindowMask(const gfx::Size& size, SkPath* window_mask) override {}
  void ResetWindowControls() override {}
  void UpdateWindowIcon() override {}
  void UpdateWindowTitle() override {}
  void SizeConstraintsChanged() override {}

 private:
  raw_ptr<views::Widget> widget_;
  base::WeakPtr<LinuxWindow> window_;
};

BEGIN_METADATA(ShellFrameView)
END_METADATA

class ShellClientView : public views::ClientView {
  METADATA_HEADER(ShellClientView, views::ClientView)

 public:
  ShellClientView(views::Widget* widget,
                  views::View* contents,
                  base::WeakPtr<LinuxWindow> window)
      : views::ClientView(widget, contents), window_(std::move(window)) {}

  views::CloseRequestResult OnWindowCloseRequested() override {
    if (!window_ || window_->can_close_widget()) {
      return views::CloseRequestResult::kCanClose;
    }
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&LinuxWindow::CloseRequestedByUser, window_));
    return views::CloseRequestResult::kCannotClose;
  }

 private:
  base::WeakPtr<LinuxWindow> window_;
};

BEGIN_METADATA(ShellClientView)
END_METADATA

class LinuxLocationBar : public LocationBar {
 public:
  LinuxLocationBar() : LocationBar(nullptr) {}
  ~LinuxLocationBar() override = default;
  void set_browser(BrowserWindowInterface* browser) { browser_ = browser; }

  void FocusLocation(bool is_user_initiated, bool clear_focus_if_failed) override {}
  void FocusSearch() override {}
  void UpdateFocusBehavior(bool toolbar_visible) override {}
  void UpdateContentSettingsIcons() override {}
  void SaveStateToContents(content::WebContents* contents) override {}
  void Revert() override {}
  OmniboxView* GetOmniboxView() override { return nullptr; }
  OmniboxPopupView* GetOmniboxPopupView() override { return nullptr; }
  OmniboxController* GetOmniboxController() override { return nullptr; }
  bool ShouldCloseOmniboxPopup(ui::MouseEvent* event) override { return false; }
  content::WebContents* GetWebContents() override {
    return browser_ ? browser_->GetTabStripModel()->GetActiveWebContents()
                    : nullptr;
  }
  LocationBarModel* GetLocationBarModel() override { return nullptr; }
  std::optional<bubble_anchor_util::AnchorConfiguration> GetChipAnchor()
      override {
    return std::nullopt;
  }
  ChipController* GetChipController() override { return nullptr; }
  void AnnounceAlert(const std::u16string& announcement) override {}
  void OnChanged() override {}
  void UpdateWithoutTabRestore() override {}
  ui::TrackedElement* GetAnchorOrNull() override { return nullptr; }
  BrowserWindowInterface* GetBrowser() override { return browser_; }
  Profile* GetProfile() override {
    return browser_ ? browser_->GetProfile() : nullptr;
  }
  bool IsInitialized() const override { return true; }
  bool IsVisible() const override { return false; }
  bool IsDrawn() const override { return false; }
  bool IsFullscreen() const override { return false; }
  bool IsEditingOrEmpty() const override { return false; }
  bool IsMouseHovered() const override { return false; }
  bool IsFocusWithin() const override { return false; }
  void InvalidateLayout() override {}
  gfx::Rect Bounds() const override { return gfx::Rect(); }
  gfx::Rect BoundsInScreen() const override { return gfx::Rect(); }
  gfx::Size MinimumSize() const override { return gfx::Size(); }
  gfx::Size PreferredSize() const override { return gfx::Size(); }
  void Update(content::WebContents* contents) override {}
  void ResetTabState(content::WebContents* contents) override {}
  bool HasSecurityStateChanged() override { return false; }
  LocationBarTesting* GetLocationBarForTesting() override { return nullptr; }

 private:
  raw_ptr<BrowserWindowInterface> browser_ = nullptr;
};

class LinuxAutofillBubbleHandler : public autofill::AutofillBubbleHandler {
 public:
  LinuxAutofillBubbleHandler() = default;
  ~LinuxAutofillBubbleHandler() override = default;

  autofill::AutofillBubbleBase* ShowSaveCreditCardBubble(
      content::WebContents* web_contents,
      autofill::SaveCardBubbleController* controller,
      bool is_user_gesture) override {
    return ardiacore::ShowSaveCardPrompt(web_contents, controller);
  }
  autofill::AutofillBubbleBase* ShowIbanBubble(
      content::WebContents* web_contents,
      autofill::IbanBubbleController* controller,
      bool is_user_gesture,
      autofill::IbanBubbleType bubble_type) override {
    return ardiacore::SkipIbanBubble(web_contents);
  }
  autofill::AutofillBubbleBase* ShowOfferNotificationBubble(
      content::WebContents* web_contents,
      autofill::OfferNotificationBubbleController* controller,
      bool is_user_gesture) override {
    return ardiacore::SkipOfferNotification(web_contents);
  }
  autofill::AutofillBubbleBase* ShowSaveAutofillAiDataBubble(
      content::WebContents* web_contents,
      autofill::AutofillAiImportDataController* controller) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowAutofillAiLocalSaveNotification(
      content::WebContents* web_contents,
      autofill::AutofillAiImportDataController* controller) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowSaveAddressProfileBubble(
      content::WebContents* web_contents,
      std::unique_ptr<autofill::SaveAddressBubbleController> controller,
      bool is_user_gesture) override {
    return ardiacore::ShowSaveAddressPrompt(web_contents, std::move(controller));
  }
#if BUILDFLAG(ENABLE_DICE_SUPPORT)
  autofill::AutofillBubbleBase* ShowAddressSignInPromo(
      content::WebContents* web_contents,
      const autofill::AutofillProfile& autofill_profile) override {
    return ardiacore::SkipAddressSignInPromo(web_contents);
  }
#endif
  autofill::AutofillBubbleBase* ShowUpdateAddressProfileBubble(
      content::WebContents* web_contents,
      std::unique_ptr<autofill::UpdateAddressBubbleController> controller,
      bool is_user_gesture) override {
    return ardiacore::ShowUpdateAddressPrompt(web_contents,
                                              std::move(controller));
  }
  autofill::AutofillBubbleBase* ShowFilledCardInformationBubble(
      content::WebContents* web_contents,
      autofill::FilledCardInformationBubbleController* controller,
      bool is_user_gesture) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowVirtualCardEnrollBubble(
      content::WebContents* web_contents,
      autofill::VirtualCardEnrollBubbleController* controller,
      bool is_user_gesture) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowVirtualCardEnrollConfirmationBubble(
      content::WebContents* web_contents,
      autofill::VirtualCardEnrollBubbleController* controller) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowMandatoryReauthBubble(
      content::WebContents* web_contents,
      autofill::MandatoryReauthBubbleController* controller,
      bool is_user_gesture,
      autofill::MandatoryReauthBubbleType bubble_type) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowSaveCardConfirmationBubble(
      content::WebContents* web_contents,
      autofill::SaveCardBubbleController* controller) override {
    return ardiacore::ShowSaveCardPrompt(web_contents, controller);
  }
  autofill::AutofillBubbleBase* ShowSaveIbanConfirmationBubble(
      content::WebContents* web_contents,
      autofill::IbanBubbleController* controller) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowOmniboxAutofillBubble(
      content::WebContents* web_contents,
      autofill::OmniboxAutofillBubbleController* controller) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowPaymentsChurnedUsersBubble(
      content::WebContents* web_contents,
      autofill::PaymentsChurnedUsersBubbleController* controller,
      bool is_user_gesture) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowPaymentsChurnedUsersConfirmationBubble(
      content::WebContents* web_contents,
      autofill::PaymentsChurnedUsersBubbleController* controller) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowWalletReminderNoticeBubble(
      content::WebContents* web_contents,
      autofill::WalletReminderNoticeBubbleController* controller,
      bool is_user_gesture) override {
    return nullptr;
  }
};

class LinuxFindBar : public FindBar {
 public:
  LinuxFindBar() = default;
  ~LinuxFindBar() override = default;

  FindBarController* GetFindBarController() const override {
    return controller_;
  }
  void SetFindBarController(FindBarController* controller) override {
    controller_ = controller;
  }
  void Show(bool animate, bool focus) override { visible_ = true; }
  void Hide(bool animate) override { visible_ = false; }
  void SetFocusAndSelection() override {}
  void ClearResults(const find_in_page::FindNotificationDetails& results) override {}
  void StopAnimation() override {}
  void MoveWindowIfNecessary() override {}
  void SetFindTextAndSelectedRange(const std::u16string& find_text,
                                   const gfx::Range& selected_range) override {
    find_text_ = find_text;
  }
  std::u16string_view GetFindText() const override { return find_text_; }
  gfx::Range GetSelectedRange() const override { return gfx::Range(); }
  void UpdateUIForFindResult(const find_in_page::FindNotificationDetails& result,
                             const std::u16string& find_text) override {}
  void AudibleAlert() override {}
  bool IsFindBarVisible() const override { return visible_; }
  void RestoreSavedFocus() override {}
  bool HasGlobalFindPasteboard() const override { return false; }
  void UpdateFindBarForChangedWebContents() override {}
  bool CanPopulateFromSelectedText() override { return true; }
  const FindBarTesting* GetFindBarTesting() const override { return nullptr; }
  bool HasFocus() const override { return false; }
  void CloseOverlappingBubbles() override {}
  views::Widget* GetHostWidget() override { return nullptr; }

 private:
  raw_ptr<FindBarController> controller_ = nullptr;
  std::u16string find_text_;
  bool visible_ = false;
};

class BackgroundEyeDropper : public content::EyeDropper {
 public:
  explicit BackgroundEyeDropper(content::EyeDropperListener* listener)
      : listener_(listener) {
    LOG(WARNING) << "[ardiacore] eye dropper (background run: picks #123456)";
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&BackgroundEyeDropper::Pick,
                                  weak_factory_.GetWeakPtr()));
  }

 private:
  void Pick() { listener_->ColorSelected(SkColorSetRGB(0x12, 0x34, 0x56)); }

  raw_ptr<content::EyeDropperListener> listener_;
  base::WeakPtrFactory<BackgroundEyeDropper> weak_factory_{this};
};

class LinuxBrowserWindow : public BrowserWindow,
                           public ExclusiveAccessContext,
                           public ExclusiveAccessBubbleViewsContext,
                           public ui::AcceleratorProvider {
 public:
  explicit LinuxBrowserWindow(base::WeakPtr<LinuxWindow> host)
      : host_(std::move(host)),
        location_bar_(std::make_unique<LinuxLocationBar>()) {
    Live().insert(this);
  }
  LinuxBrowserWindow(const LinuxBrowserWindow&) = delete;
  LinuxBrowserWindow& operator=(const LinuxBrowserWindow&) = delete;

  static LinuxBrowserWindow* FromWindow(const BrowserWindow* window) {
    if (!window || !Live().contains(window)) {
      return nullptr;
    }
    return static_cast<LinuxBrowserWindow*>(const_cast<BrowserWindow*>(window));
  }

  static bool IsOurs(const BrowserWindowInterface* browser) {
    return browser && Records().contains(browser);
  }

  static LinuxWindow* HostOf(const BrowserWindowInterface* browser) {
    auto it = browser ? Records().find(browser) : Records().end();
    return it == Records().end() ? nullptr : it->second.get();
  }

  static void Forget(const BrowserWindowInterface* browser) {
    Records().erase(browser);
  }

  void Register(const BrowserWindowInterface* browser) {
    Records()[browser] = host_;
  }

  void AttachBrowser(Browser* browser) {
    browser_ = browser;
    Register(browser);
    autofill_bubble_handler_registration_.emplace(
        browser->GetUnownedUserDataHost(), autofill_bubble_handler_);
    location_bar_->set_browser(browser);
    devtools_ui_controller_ = std::make_unique<DevtoolsUIController>(
        browser,
        std::vector<raw_ptr<ContentsContainerView, DanglingUntriaged>>());
    extension_shortcuts_ =
        std::make_unique<ardiacore::ExtensionShortcuts>(browser);
  }

  Browser* browser() const { return browser_; }
  bool closed_by_chrome() const { return closed_by_chrome_; }
  base::WeakPtr<LinuxWindow> host_weak() const { return host_; }

  bool IsActive() const override {
    if (!host_ || !host_->widget()) {
      return false;
    }
    return host_->widget()->IsActive() && host_->IsActiveBrowser(browser_);
  }
  bool IsMaximized() const override { return host_ && host_->IsMaximized(); }
  bool IsMinimized() const override { return host_ && host_->IsMinimized(); }
  bool IsFullscreen() const override {
    if (tab_fullscreen_ ||
        (host_ && (host_->acted_fullscreen() || host_->IsFullscreen()))) {
      return true;
    }
    ExclusiveAccessManager* manager =
        browser_ ? ExclusiveAccessManager::From(browser_) : nullptr;
    return manager && manager->fullscreen_controller()->IsTabFullscreen();
  }
  gfx::NativeWindow GetNativeWindow() const override {
    return host_ ? host_->native_window() : gfx::NativeWindow();
  }
  gfx::Rect GetRestoredBounds() const override {
    return host_ ? host_->GetRestoredBounds() : gfx::Rect();
  }
  ui::mojom::WindowShowState GetRestoredState() const override {
    return ui::mojom::WindowShowState::kNormal;
  }
  gfx::Rect GetBounds() const override {
    return host_ ? host_->GetBounds() : gfx::Rect();
  }
  void Show() override {
    if (host_) {
      host_->ShowRequested(true);
    }
  }
  void Hide() override {}
  bool IsVisible() const override {
    return host_ && host_->IsVisible() && host_->IsActiveBrowser(browser_);
  }
  void ShowInactive() override {
    if (host_) {
      host_->ShowRequested(false);
    }
  }
  void Close() override {
    if (!browser_) {
      return;
    }
    Profile* profile = browser_->GetProfile();
    closed_by_chrome_ = host_ && !host_->closing() &&
                        !browser_shutdown::IsTryingToQuit() &&
                        !ProfileUnusable(profile);
    if (UnloadController* unload = UnloadController::From(browser_)) {
      if ((host_ && host_->closing()) || browser_shutdown::IsTryingToQuit()) {
        CloseBlankTabsBeforeWindowCloses(browser_);
      }
      unload->OnWindowClosing();
    }
  }
  void Activate() override {
    if (host_ && browser_) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE,
          base::BindOnce(
              [](base::WeakPtr<LinuxWindow> host,
                 base::WeakPtr<BrowserWindowInterface> browser) {
                if (host && browser) {
                  host->RequestActivation(static_cast<Browser*>(browser.get()));
                }
              },
              host_, browser_->GetWeakPtr()));
    }
  }
  void Deactivate() override {}
  void Maximize() override {}
  void Minimize() override {}
  void Restore() override {}
  void SetBounds(const gfx::Rect& bounds) override {
    if (host_ && host_->role() != LinuxWindow::Role::kApp) {
      host_->SetBounds(bounds);
    }
  }
  void FlashFrame(bool flash) override {}
  ui::ZOrderLevel GetZOrderLevel() const override {
    return ui::ZOrderLevel::kNormal;
  }
  void SetZOrderLevel(ui::ZOrderLevel order) override {}
  bool IsOnCurrentWorkspace() const override { return host_ && !host_->internal(); }
  bool IsVisibleOnScreen() const override { return IsVisible(); }
  void SetTopControlsShownRatio(content::WebContents* web_contents,
                                float ratio) override {}
  bool DoBrowserControlsShrinkRendererSize(
      const content::WebContents* contents) const override {
    return false;
  }
  ui::NativeTheme* GetNativeTheme() override {
    return ui::NativeTheme::GetInstanceForNativeUi();
  }
  const ui::ThemeProvider* GetThemeProvider() const override {
    return browser_ ? &ThemeService::GetThemeProviderForProfile(
                          browser_->GetProfile())
                    : nullptr;
  }
  const ui::ColorProvider* GetColorProvider() const override {
    if (host_ && host_->widget()) {
      return host_->widget()->GetColorProvider();
    }
    return ui::ColorProviderManager::Get().GetColorProviderFor(
        ui::ColorProviderKey());
  }
  int GetTopControlsHeight() const override { return 0; }
  void SetTopControlsGestureScrollInProgress(bool in_progress) override {}
  std::vector<StatusBubble*> GetStatusBubbles() override { return {}; }
  void UpdateTitleBar() override {}
  void UpdateLoadingAnimations(bool is_visible) override {}
  void OnActiveTabChanged(content::WebContents* old_contents,
                          content::WebContents* new_contents,
                          int index,
                          int reason) override {
    if (host_ && browser_) {
      host_->ActiveTabChanged(browser_, new_contents);
    }
  }
  void OnTabDetached(content::WebContents* contents, bool was_active) override {}
  gfx::Size GetContentsSize() const override {
    return host_ && host_->contents_view() ? host_->contents_view()->size()
                                           : gfx::Size();
  }
  void SetContentsSize(const gfx::Size& size) override {}
  autofill::AutofillBubbleHandler* GetAutofillBubbleHandler() override {
    return &autofill_bubble_handler_;
  }
  LocationBar* GetLocationBar() const override { return location_bar_.get(); }
  void SetFocusToLocationBar(bool is_user_initiated) override {}
  void UpdateReloadStopState(bool is_loading, bool force) override {}
  void UpdateToolbar(content::WebContents* contents) override {}
  bool UpdateToolbarSecurityState() override { return false; }
  void UpdateCustomTabBarVisibility(bool visible, bool animate) override {}
  void ResetToolbarTabState(content::WebContents* contents) override {}
  void FocusToolbar() override {}
  void ToolbarSizeChanged(bool is_animating) override {}
  void TabDraggingStatusChanged(bool is_dragging) override {}
  void LinkOpeningFromGesture(WindowOpenDisposition disposition) override {}
  void FocusAppMenu() override {}
  bool IsTabStripEditable() const override { return true; }
  void DisableTabStripEditingForTesting() override {}
  bool IsToolbarVisible() const override { return false; }
  bool IsToolbarShowing() const override { return false; }
  bool IsLocationBarVisible() const override { return false; }
  void ShowUpdateChromeDialog() override {}
  void ShowIntentPickerBubble(
      std::vector<apps::IntentPickerAppInfo> app_info,
      bool show_stay_in_chrome,
      bool show_remember_selection,
      apps::IntentPickerBubbleType bubble_type,
      const std::optional<url::Origin>& initiating_origin,
      IntentPickerResponse callback) override {}
  void ShowBookmarkBubble(const GURL& url, bool already_bookmarked) override {}
  ShowTranslateBubbleResult ShowTranslateBubble(
      content::WebContents* contents,
      translate::TranslateStep step,
      const std::string& source_language,
      const std::string& target_language,
      translate::TranslateErrors error_type,
      bool is_user_gesture) override {
    return ShowTranslateBubbleResult::kBrowserWindowNotValid;
  }
  DownloadBubbleUIController* GetDownloadBubbleUIController() override {
    return nullptr;
  }
  void ConfirmBrowserCloseWithPendingDownloads(
      int download_count,
      DownloadCloseType dialog_type,
      base::OnceCallback<void(bool)> callback) override {
    if (host_ && !host_->closing() && !ardiacore::IsQuitting()) {
      host_->ConfirmCloseWithDownloads(download_count, std::move(callback));
      return;
    }
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(std::move(callback), true));
  }
  void ShowAppMenu() override {}
  void PreHandleDragUpdate(const content::DropData& drop_data,
                           const gfx::PointF& point) override {}
  void PreHandleDragExit() override {}
  void HandleDragEnded() override {}
  content::KeyboardEventProcessingResult PreHandleKeyboardEvent(
      const input::NativeWebKeyboardEvent& event) override {
    if (!host_ || event.GetType() != input::NativeWebKeyboardEvent::Type::kRawKeyDown) {
      return content::KeyboardEventProcessingResult::NOT_HANDLED;
    }
    if (host_->PreHandleKey(event)) {
      return content::KeyboardEventProcessingResult::HANDLED;
    }
    if (extension_shortcuts_ &&
        extension_shortcuts_->Run(
            ui::GetAcceleratorFromNativeWebKeyboardEvent(event))) {
      return content::KeyboardEventProcessingResult::HANDLED;
    }
    return content::KeyboardEventProcessingResult::NOT_HANDLED;
  }
  bool HandleKeyboardEvent(const input::NativeWebKeyboardEvent& event) override {
    if (!host_ || !browser_) {
      return false;
    }
    return host_->HandleKey(browser_->GetTabStripModel()->GetActiveWebContents(),
                            event);
  }
  std::unique_ptr<FindBar> CreateFindBar() override {
    return std::make_unique<LinuxFindBar>();
  }
  web_modal::WebContentsModalDialogHost* GetWebContentsModalDialogHost()
      override {
    return host_.get();
  }
  web_modal::WebContentsModalDialogHost* GetWebContentsModalDialogHostFor(
      content::WebContents* web_contents) override {
    return host_.get();
  }
  void ShowAvatarBubbleFromAvatarButton(bool is_source_accelerator) override {}
  void MaybeShowProfileSwitchIPH() override {}
  void MaybeShowSupervisedUserProfileSignInIPH() override {}
  void ShowHatsDialog(
      const std::string& site_id,
      const std::optional<std::string>& hats_histogram_name,
      const std::optional<uint64_t> hats_survey_ukm_id,
      base::OnceClosure success_callback,
      base::OnceClosure failure_callback,
      const SurveyBitsData& product_specific_bits_data,
      const SurveyStringData& product_specific_string_data) override {}
  ExclusiveAccessContext* GetExclusiveAccessContext() override { return this; }
  std::string GetWorkspace() const override { return std::string(); }
  bool IsVisibleOnAllWorkspaces() const override { return false; }
  void ShowEmojiPanel() override {
    base::WeakPtr<LinuxBrowserWindow> self = weak_factory_.GetWeakPtr();
    if (content::WebContents* contents =
            browser_ ? browser_->GetTabStripModel()->GetActiveWebContents()
                     : nullptr) {
      if (!contents->ForSecurityDropFullscreen(display::kInvalidDisplayId) ||
          !self) {
        return;
      }
    }
    if (host_ && host_->widget()) {
      host_->widget()->ShowEmojiPanel();
    }
  }
  std::unique_ptr<content::EyeDropper> OpenEyeDropper(
      content::RenderFrameHost* frame,
      content::EyeDropperListener* listener) override {
    if (Background() && listener) {
      return features::IsEyeDropperEnabled()
                 ? std::make_unique<BackgroundEyeDropper>(listener)
                 : nullptr;
    }
    return ShowEyeDropper(frame, listener);
  }
  void ShowCaretBrowsingDialog() override {}
  void CreateTabSearchBubble() override {}
  void CloseTabSearchBubble() override {}
  void ShowIncognitoClearBrowsingDataDialog() override {}
  void ShowIncognitoHistoryDisclaimerDialog() override {}
  bool IsUnframedModeEnabled() const override { return false; }
  bool GetCanResize() override { return true; }
  ui::mojom::WindowShowState GetWindowShowState() const override {
    if (IsMinimized()) {
      return ui::mojom::WindowShowState::kMinimized;
    }
    if (IsFullscreen()) {
      return ui::mojom::WindowShowState::kFullscreen;
    }
    if (IsMaximized()) {
      return ui::mojom::WindowShowState::kMaximized;
    }
    return ui::mojom::WindowShowState::kNormal;
  }
  void ShowChromeLabs() override {}
  BrowserView* AsBrowserView() override { return nullptr; }

  Profile* GetProfile() override {
    return browser_ ? browser_->GetProfile() : nullptr;
  }
  void EnterFullscreen(const url::Origin& origin,
                       ExclusiveAccessBubbleType bubble_type,
                       FullscreenTabParams fullscreen_tab_params) override {
    tab_fullscreen_ = true;
    base::WeakPtr<LinuxBrowserWindow> self = weak_factory_.GetWeakPtr();
    ReportFullscreenTab();
    if (self) {
      PostWindowFullscreenStateChanged();
    }
  }
  void ExitFullscreen() override {
    tab_fullscreen_ = false;
    ReportFullscreenTab();
  }
  void UpdateExclusiveAccessBubble(
      const ExclusiveAccessBubbleParams& params,
      ExclusiveAccessBubbleHideCallback first_hide_callback) override {
    base::WeakPtr<LinuxBrowserWindow> self = weak_factory_.GetWeakPtr();
    ReportFullscreenTab();
    if (!self) {
      return;
    }
    const bool can_show = host_ && host_->widget() && browser_ &&
                          GetExclusiveAccessManager();
    const bool should_close_bubble =
        !can_show || (!params.has_download &&
                      params.type == EXCLUSIVE_ACCESS_BUBBLE_TYPE_NONE);
    if (should_close_bubble) {
      if (first_hide_callback) {
        std::move(first_hide_callback)
            .Run(ExclusiveAccessBubbleHideReason::kNotShown);
      }
      if (!exclusive_access_bubble_ ||
          exclusive_access_bubble_destruction_task_id_) {
        return;
      }
      exclusive_access_bubble_->HideImmediately();
      exclusive_access_bubble_destruction_task_id_ =
          exclusive_access_bubble_task_tracker_.PostTask(
              base::SingleThreadTaskRunner::GetCurrentDefault().get(),
              FROM_HERE,
              base::BindOnce(&LinuxBrowserWindow::DestroyAnyExclusiveAccessBubble,
                             weak_factory_.GetWeakPtr()));
      return;
    }
    if (exclusive_access_bubble_) {
      if (exclusive_access_bubble_destruction_task_id_) {
        exclusive_access_bubble_task_tracker_.TryCancel(
            *exclusive_access_bubble_destruction_task_id_);
        exclusive_access_bubble_destruction_task_id_.reset();
      }
      exclusive_access_bubble_->Update(params, std::move(first_hide_callback));
      return;
    }
    exclusive_access_bubble_ = std::make_unique<ExclusiveAccessBubbleViews>(
        this, params, std::move(first_hide_callback));
  }
  bool IsExclusiveAccessBubbleDisplayed() const override {
    return exclusive_access_bubble_ &&
           (exclusive_access_bubble_->IsShowing() ||
            exclusive_access_bubble_->IsVisible());
  }
  void OnExclusiveAccessUserInput() override {
    if (exclusive_access_bubble_) {
      exclusive_access_bubble_->OnUserInput();
    }
  }
  content::WebContents* GetWebContentsForExclusiveAccess() override {
    return browser_ ? browser_->GetTabStripModel()->GetActiveWebContents()
                    : nullptr;
  }
  bool CanUserEnterFullscreen() const override { return true; }
  bool CanUserExitFullscreen() const override { return true; }

  ExclusiveAccessManager* GetExclusiveAccessManager() override {
    return browser_ ? ExclusiveAccessManager::From(browser_) : nullptr;
  }
  ui::AcceleratorProvider* GetAcceleratorProvider() override { return this; }
  gfx::NativeView GetBubbleParentView() const override {
    return host_ ? host_->native_view() : gfx::NativeView();
  }
  gfx::Rect GetClientAreaBoundsInScreen() const override {
    return host_ && host_->widget()
               ? host_->widget()->GetClientAreaBoundsInScreen()
               : gfx::Rect();
  }
  bool IsImmersiveModeEnabled() const override { return false; }
  gfx::Rect GetTopContainerBoundsInScreen() override { return gfx::Rect(); }
  void DestroyAnyExclusiveAccessBubble() override {
    exclusive_access_bubble_.reset();
    exclusive_access_bubble_destruction_task_id_.reset();
  }
  void RepositionExclusiveAccessBubble() {
    if (exclusive_access_bubble_) {
      exclusive_access_bubble_->RepositionIfVisible();
    }
  }

  bool GetAcceleratorForCommandId(int command_id,
                                  ui::Accelerator* accelerator) const override {
    if (command_id != IDC_FULLSCREEN) {
      return false;
    }
    *accelerator = ui::Accelerator(ui::VKEY_F11, ui::EF_NONE);
    return true;
  }

 protected:
  void DeleteBrowserWindow() override { delete this; }

 private:
  ~LinuxBrowserWindow() override {
    Live().erase(this);
    extension_shortcuts_.reset();
    DestroyAnyExclusiveAccessBubble();
    devtools_ui_controller_.reset();
    autofill_bubble_handler_registration_.reset();
    if (browser_) {
      browser_->GetFeatures().TearDownPreBrowserWindowDestruction();
    }
    if (host_) {
      host_->BrowserWindowDestroyed(this);
    }
  }

  static std::set<const BrowserWindow*>& Live() {
    static base::NoDestructor<std::set<const BrowserWindow*>> windows;
    return *windows;
  }

  static std::map<const BrowserWindowInterface*, base::WeakPtr<LinuxWindow>>&
  Records() {
    static base::NoDestructor<
        std::map<const BrowserWindowInterface*, base::WeakPtr<LinuxWindow>>>
        records;
    return *records;
  }

  void PostWindowFullscreenStateChanged() {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(
            [](base::WeakPtr<LinuxBrowserWindow> window) {
              ExclusiveAccessManager* manager =
                  window ? window->GetExclusiveAccessManager() : nullptr;
              if (manager && window->tab_fullscreen_) {
                manager->fullscreen_controller()->WindowFullscreenStateChanged();
              }
            },
            weak_factory_.GetWeakPtr()));
  }

  void ReportFullscreenTab() {
    ExclusiveAccessManager* manager =
        browser_ ? ExclusiveAccessManager::From(browser_) : nullptr;
    FullscreenController* controller =
        manager ? manager->fullscreen_controller() : nullptr;
    content::WebContents* now = controller && controller->IsTabFullscreen()
                                    ? controller->exclusive_access_tab()
                                    : nullptr;
    content::WebContents* was = fullscreen_tab_.get();
    if (now == was) {
      return;
    }
    fullscreen_tab_ = now ? now->GetWeakPtr() : nullptr;
    if (!host_ || !browser_) {
      return;
    }
    base::WeakPtr<content::WebContents> entering = fullscreen_tab_;
    if (was) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE,
          base::BindOnce(
              [](base::WeakPtr<content::WebContents> left) {
                content::RenderWidgetHostView* view =
                    left ? left->GetRenderWidgetHostView() : nullptr;
                if (view && !left->IsFullscreen()) {
                  view->GetRenderWidgetHost()->SynchronizeVisualProperties();
                }
              },
              was->GetWeakPtr()));
      host_->FullscreenChanged(was, false);
    }
    if (content::WebContents* contents = entering.get();
        contents && contents == fullscreen_tab_.get() && host_) {
      host_->FullscreenChanged(contents, true);
    }
  }

  base::WeakPtr<LinuxWindow> host_;
  raw_ptr<Browser> browser_ = nullptr;
  std::unique_ptr<LinuxLocationBar> location_bar_;
  std::unique_ptr<ardiacore::ExtensionShortcuts> extension_shortcuts_;
  LinuxAutofillBubbleHandler autofill_bubble_handler_;
  std::optional<ui::ScopedUnownedUserData<autofill::AutofillBubbleHandler>>
      autofill_bubble_handler_registration_;
  bool tab_fullscreen_ = false;
  bool closed_by_chrome_ = false;
  base::WeakPtr<content::WebContents> fullscreen_tab_;
  std::unique_ptr<DevtoolsUIController> devtools_ui_controller_;
  std::unique_ptr<ExclusiveAccessBubbleViews> exclusive_access_bubble_;
  base::CancelableTaskTracker exclusive_access_bubble_task_tracker_;
  std::optional<base::CancelableTaskTracker::TaskId>
      exclusive_access_bubble_destruction_task_id_;
  base::WeakPtrFactory<LinuxBrowserWindow> weak_factory_{this};
};

namespace {

bool IsWindowDisposition(WindowOpenDisposition d) {
  return d == WindowOpenDisposition::NEW_POPUP ||
         d == WindowOpenDisposition::NEW_WINDOW;
}

bool IsNewTabDisposition(WindowOpenDisposition d) {
  return IsWindowDisposition(d) ||
         d == WindowOpenDisposition::NEW_FOREGROUND_TAB ||
         d == WindowOpenDisposition::NEW_BACKGROUND_TAB;
}

class LinuxWebContentsDelegate : public BrowserWebContentsDelegate {
 public:
  LinuxWebContentsDelegate(BrowserWindowInterface* browser,
                           ExclusiveAccessManager& exclusive_access_manager,
                           chrome::BrowserCommandController& command_controller,
                           UnloadController& unload_controller,
                           web_app::AppBrowserController* app_browser_controller,
                           BrowserWindow& window,
                           DesktopBrowserWindowCapabilities& capabilities,
                           BrowserUiController& browser_ui_controller,
                           base::WeakPtr<LinuxWindow> host)
      : BrowserWebContentsDelegate(browser,
                                   exclusive_access_manager,
                                   command_controller,
                                   unload_controller,
                                   app_browser_controller,
                                   window,
                                   capabilities,
                                   browser_ui_controller),
        host_(std::move(host)),
        ours_(browser) {}

  ~LinuxWebContentsDelegate() override { LinuxBrowserWindow::Forget(ours_); }

  content::WebContents* OpenURLFromTab(
      content::WebContents* source,
      const content::OpenURLParams& params,
      base::OnceCallback<void(content::NavigationHandle&)>
          navigation_handle_callback) override {
    if (source && params.url.SchemeIs(url::kJavaScriptScheme)) {
      ardiacore::EndAheadBlank(source);
    }
    if (ardiacore::IsAppURL(params.url)) {
      if (source && ardiacore::IsWebUIURL(source->GetLastCommittedURL())) {
        ardiacore::ReportAppURLRequest(source, params.url, params.user_gesture);
      }
      return nullptr;
    }
    LinuxWindow* host = host_.get();
    if (!host || !IsNewTabDisposition(params.disposition)) {
      return BrowserWebContentsDelegate::OpenURLFromTab(
          source, params, std::move(navigation_handle_callback));
    }
    content::OpenURLParams tab_params(params);
    LinuxWindow::PendingOpen open{params.disposition,
                                  source ? source->GetWeakPtr() : nullptr};
    base::AutoReset<LinuxWindow::PendingOpen> pending(&host->pending_open(),
                                                      std::move(open));
    if (IsWindowDisposition(params.disposition)) {
      tab_params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
    }
    return BrowserWebContentsDelegate::OpenURLFromTab(
        source, tab_params, std::move(navigation_handle_callback));
  }

  content::WebContents* AddNewContents(
      content::WebContents* source,
      std::unique_ptr<content::WebContents> new_contents,
      const GURL& target_url,
      WindowOpenDisposition disposition,
      const blink::mojom::WindowFeatures& window_features,
      bool user_gesture,
      bool* was_blocked) override {
    if (ardiacore::IsAppURL(target_url)) {
      if (source && ardiacore::IsWebUIURL(source->GetLastCommittedURL())) {
        ardiacore::ReportAppURLRequest(source, target_url, user_gesture);
      }
      return nullptr;
    }
    if (host_ && new_contents) {
      NoteOpen(new_contents.get(), disposition, source);
      if (disposition == WindowOpenDisposition::NEW_POPUP) {
        base::DictValue features;
        const gfx::Rect& bounds = window_features.bounds;
        if (window_features.has_x) {
          features.Set("x", bounds.x());
        }
        if (window_features.has_y) {
          features.Set("y", bounds.y());
        }
        if (window_features.has_width) {
          features.Set("width", bounds.width());
        }
        if (window_features.has_height) {
          features.Set("height", bounds.height());
        }
        TabOpenInfo::FromWebContents(new_contents.get())->popup_features =
            std::move(features);
      }
      if (IsWindowDisposition(disposition)) {
        disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
      }
    }
    return BrowserWebContentsDelegate::AddNewContents(
        source, std::move(new_contents), target_url, disposition,
        window_features, user_gesture, was_blocked);
  }

  void UpdateTargetURL(content::WebContents* source, const GURL& url) override {
    BrowserWebContentsDelegate::UpdateTargetURL(source, url);
    TabStatusTextChanged(source, url);
  }

  void RequestMediaAccessPermission(
      content::WebContents* web_contents,
      const content::MediaStreamRequest& request,
      content::MediaResponseCallback callback) override {
    content::MediaStreamRequest granted(request);
    ardiacore::ApplyDesktopCaptureGrant(web_contents, granted);
    ardiacore::KeepAudioCaptureFake(granted);
    BrowserWebContentsDelegate::RequestMediaAccessPermission(
        web_contents, granted, std::move(callback));
  }

  void ActivateContents(content::WebContents* contents) override {
    const bool pip =
        PictureInPictureWindowManager::GetInstance()->GetWebContents() ==
        contents;
    if (!TabRequestsActivation(contents, pip ? "pictureInPicture" : "page")) {
      BrowserWebContentsDelegate::ActivateContents(contents);
    }
  }

  void RendererUnresponsive(content::WebContents* source,
                            content::RenderWidgetHost* render_widget_host,
                            base::RepeatingClosure hang_monitor_restarter) override {
    TabUnresponsive(source, render_widget_host,
                    std::move(hang_monitor_restarter));
  }

  void RendererResponsive(content::WebContents* source,
                          content::RenderWidgetHost* render_widget_host) override {
    TabResponsive(source, render_widget_host);
  }

 private:
  base::WeakPtr<LinuxWindow> host_;
  raw_ptr<const BrowserWindowInterface> ours_;
};

}

const char* DispositionName(WindowOpenDisposition disposition) {
  switch (disposition) {
    case WindowOpenDisposition::CURRENT_TAB:
      return "current_tab";
    case WindowOpenDisposition::SINGLETON_TAB:
      return "singleton_tab";
    case WindowOpenDisposition::NEW_FOREGROUND_TAB:
      return "foreground_tab";
    case WindowOpenDisposition::NEW_BACKGROUND_TAB:
      return "background_tab";
    case WindowOpenDisposition::NEW_POPUP:
      return "popup";
    case WindowOpenDisposition::NEW_WINDOW:
      return "window";
    case WindowOpenDisposition::NEW_PICTURE_IN_PICTURE:
      return "picture_in_picture";
    case WindowOpenDisposition::OFF_THE_RECORD:
      return "off_the_record";
    case WindowOpenDisposition::NEW_SPLIT_VIEW:
      return "split_view";
    default:
      return "other";
  }
}

std::string AppDisposition(std::string_view chrome_disposition) {
  static constexpr std::pair<std::string_view, std::string_view> kMap[] = {
      {"foreground_tab", "foreground"}, {"background_tab", "background"},
      {"popup", "popup"},               {"window", "window"},
      {"off_the_record", "incognito"},  {"current_tab", "current"},
      {"split_view", "split"},          {"singleton_tab", "foreground"},
  };
  for (const auto& [chrome, app] : kMap) {
    if (chrome == chrome_disposition) {
      return std::string(app);
    }
  }
  return "foreground";
}

std::optional<base::DictValue> PopupFeaturesOf(content::WebContents* contents) {
  TabOpenInfo* info = contents ? TabOpenInfo::FromWebContents(contents) : nullptr;
  if (!info || !info->popup_features) {
    return std::nullopt;
  }
  return info->popup_features->Clone();
}

bool IsNotifyingTabStrip() {
  return g_tab_strip_notifying > 0;
}

void ConfirmQuitWithDownloads(int count,
                              base::OnceCallback<void(bool)> callback) {
  LinuxWindow* window =
      LinuxWindow::ForBrowser(GetLastActiveBrowserWindowInterfaceWithAnyProfile());
  if (!window) {
    window = LinuxWindow::LastActive();
  }
  if (!window && !LinuxWindow::All().empty()) {
    window = LinuxWindow::All().back();
  }
  if (window) {
    window->ConfirmCloseWithDownloads(count, std::move(callback));
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(std::move(callback), true));
}

void NotifyWindowsQuitCancelled() {
  for (LinuxWindow* window : std::vector<LinuxWindow*>(LinuxWindow::All())) {
    window->QuitCancelled();
  }
}

std::unique_ptr<BrowserWebContentsDelegate> CreateWebContentsDelegate(
    BrowserWindowInterface* browser,
    ExclusiveAccessManager& exclusive_access_manager,
    chrome::BrowserCommandController& command_controller,
    UnloadController& unload_controller,
    web_app::AppBrowserController* app_browser_controller,
    BrowserWindow& window,
    DesktopBrowserWindowCapabilities& capabilities,
    BrowserUiController& browser_ui_controller) {
  LinuxBrowserWindow* ours = LinuxBrowserWindow::FromWindow(&window);
  if (!ours) {
    return nullptr;
  }
  ours->Register(browser);
  return std::make_unique<LinuxWebContentsDelegate>(
      browser, exclusive_access_manager, command_controller, unload_controller,
      app_browser_controller, window, capabilities, browser_ui_controller,
      ours->host_weak());
}

WindowOptions::WindowOptions() = default;
WindowOptions::WindowOptions(const WindowOptions&) = default;
WindowOptions& WindowOptions::operator=(const WindowOptions&) = default;
WindowOptions::~WindowOptions() = default;

LinuxWindow::LinuxWindow(Role role, const gfx::Rect& bounds) : role_(role) {
  Windows().push_back(this);
  InitWidget(bounds);
}

LinuxWindow::~LinuxWindow() {
  std::erase(Windows(), this);
  for (auto& observer : modal_observers_) {
    observer.OnHostDestroying();
  }
  for (auto& [profile, browser] : browsers_) {
    browser->GetTabStripModel()->RemoveObserver(this);
    if (auto* elements = BrowserElementsViews::From(browser)) {
      elements->TearDown();
    }
  }
  browsers_.clear();
  for (auto& [view_id, slot] : native_views_) {
    if (slot->view && slot->container) {
      slot->container->RemoveChildView(slot->view);
    }
  }
  native_views_.clear();
  widget_close_allowed_ = true;
  ReleaseHostPage();
  Observe(nullptr);
  if (shell_view_) {
    shell_view_->SetWebContents(nullptr);
  }
  if (widget_) {
    widget_->RemoveObserver(this);
  }
  widget_.reset();
  shell_.reset();
}

void LinuxWindow::InitWidget(const gfx::Rect& bounds) {
  widget_delegate_ = std::make_unique<views::WidgetDelegate>();
  widget_delegate_->SetCanResize(true);
  widget_delegate_->SetCanMaximize(true);
  widget_delegate_->SetCanMinimize(true);
  widget_delegate_->SetCanFullscreen(true);
  widget_delegate_->SetTitle(u"Ardia");
  widget_delegate_->SetClientViewFactory(base::BindOnce(
      [](base::WeakPtr<LinuxWindow> window, views::Widget* widget,
         views::View* contents) -> std::unique_ptr<views::ClientView> {
        return std::make_unique<ShellClientView>(widget, contents, window);
      },
      GetWeakPtr()));
  if (role_ != Role::kPopup) {
    widget_delegate_->SetFrameViewFactory(base::BindRepeating(
        [](base::WeakPtr<LinuxWindow> window,
           views::Widget* widget) -> std::unique_ptr<views::FrameView> {
          return std::make_unique<ShellFrameView>(widget, window);
        },
        GetWeakPtr()));
  }
  auto contents = std::make_unique<ShellContentsView>();
  contents_view_ = widget_delegate_->SetContentsView(std::move(contents));

  widget_ = std::make_unique<views::Widget>();
  views::Widget::InitParams params(
      views::Widget::InitParams::CLIENT_OWNS_WIDGET,
      views::Widget::InitParams::TYPE_WINDOW);
  params.delegate = widget_delegate_.get();
  params.bounds = bounds;
  params.name = "ArdiaCoreWindow";
  params.wm_class_name = "ardia";
  params.wm_class_class = "Ardia";
  params.wayland_app_id = "dev.ardia.Ardia";
  params.remove_standard_frame = role_ != Role::kPopup;
  params.opacity = views::Widget::InitParams::WindowOpacity::kOpaque;
  widget_->Init(std::move(params));
  widget_->AddObserver(this);
}

const std::vector<LinuxWindow*>& LinuxWindow::All() {
  return Windows();
}

void LinuxWindow::AddObserver(Observer* observer) {
  WindowObservers().AddObserver(observer);
}

void LinuxWindow::RemoveObserver(Observer* observer) {
  WindowObservers().RemoveObserver(observer);
}

void LinuxWindow::SetCloseRequestHandler(CloseRequestHandler handler) {
  CloseRequests() = std::move(handler);
}

void LinuxWindow::SetKeyHandler(KeyHandler handler) {
  Keys() = std::move(handler);
}

void LinuxWindow::SetDownloadsConfirmHandler(DownloadsConfirmHandler handler) {
  DownloadsConfirms() = std::move(handler);
}

void LinuxWindow::SetPasswordPromptSource(PasswordPromptSource source) {
  PasswordPrompts() = std::move(source);
}

LinuxWindow* LinuxWindow::ForId(std::string_view window_id) {
  if (window_id.empty()) {
    return nullptr;
  }
  for (LinuxWindow* window : Windows()) {
    if (window->window_id_ == window_id && !window->widget_close_allowed_) {
      return window;
    }
  }
  return nullptr;
}

LinuxWindow* LinuxWindow::ForBrowser(const BrowserWindowInterface* browser) {
  return LinuxBrowserWindow::HostOf(browser);
}

LinuxWindow* LinuxWindow::ForWidget(const views::Widget* widget) {
  for (LinuxWindow* window : Windows()) {
    if (widget && window->widget_.get() == widget) {
      return window;
    }
  }
  return nullptr;
}

LinuxWindow* LinuxWindow::ForNativeWindow(gfx::NativeWindow native) {
  views::Widget* widget = views::Widget::GetWidgetForNativeWindow(native);
  return ForWidget(widget ? widget->GetTopLevelWidget() : nullptr);
}

LinuxWindow* LinuxWindow::ForShell(const content::WebContents* shell) {
  for (LinuxWindow* window : Windows()) {
    if (shell && window->shell_.get() == shell) {
      return window;
    }
  }
  return nullptr;
}

LinuxWindow* LinuxWindow::ForTab(const content::WebContents* contents) {
  if (!contents) {
    return nullptr;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  return browser ? ForBrowser(browser) : nullptr;
}

LinuxWindow* LinuxWindow::LastActive() {
  for (LinuxWindow* window : WindowsInActivationOrder()) {
    if (window->role_ == Role::kApp && !window->widget_close_allowed_) {
      return window;
    }
  }
  return nullptr;
}

LinuxWindow* LinuxWindow::Open(const WindowOptions& options) {
  if (!HostStarted()) {
    return nullptr;
  }
  if (LinuxWindow* existing = ForId(options.window_id)) {
    if (options.focus) {
      existing->Focus();
    }
    return existing;
  }
  LinuxWindow* window = ClaimChromeMadeWindow(options.chrome_window);
  if (!window) {
    const gfx::Size size =
        options.kind == "small" ? kSmallWindowSize : kDefaultWindowSize;
    gfx::Rect bounds = options.bounds.value_or(gfx::Rect(size));
    auto made = std::make_unique<LinuxWindow>(Role::kApp, bounds);
    window = made.get();
    OwnedWindows().push_back(std::move(made));
    if (!options.bounds) {
      window->widget_->CenterWindow(bounds.size());
    }
  } else if (options.bounds) {
    window->SetBounds(*options.bounds);
  }
  window->role_ = Role::kApp;
  window->window_id_ = options.window_id;
  window->kind_ = options.kind;
  window->reveal_focus_ = options.focus;
  if (options.minimum_size) {
    window->SetMinimumSize(*options.minimum_size);
  }
  window->SetTitle(options.title.empty() ? u"Ardia" : options.title);
  window->ShowProfile(options.profile);
  window->RequestShellDocument();
  return window;
}

LinuxWindow* LinuxWindow::ClaimChromeMadeWindow(const std::string& token) {
  if (token.empty()) {
    return nullptr;
  }
  auto it = ChromeMadeWindows().find(token);
  if (it == ChromeMadeWindows().end()) {
    return nullptr;
  }
  base::WeakPtr<LinuxWindow> window = it->second;
  ChromeMadeWindows().erase(it);
  if (!window || !window->awaiting_app_ || window->widget_close_allowed_) {
    return nullptr;
  }
  window->awaiting_app_ = false;
  window->awaiting_app_timer_.Stop();
  return window.get();
}

LinuxWindow* LinuxWindow::StandaloneWindowFor(Profile* profile) {
  auto& windows = StandaloneWindows();
  if (auto it = windows.find(profile); it != windows.end() && it->second &&
                                       !it->second->widget_close_allowed_) {
    return it->second.get();
  }
  auto made = std::make_unique<LinuxWindow>(Role::kStandalone,
                                            gfx::Rect(kSmallWindowSize));
  LinuxWindow* window = made.get();
  OwnedWindows().push_back(std::move(made));
  window->internal_ = true;
  windows[profile] = window->GetWeakPtr();
  return window;
}

LinuxWindow* LinuxWindow::HostingWindowFor(Profile* profile) {
  for (LinuxWindow* window : WindowsInActivationOrder()) {
    if (window->role_ == Role::kApp && !window->awaiting_app_ &&
        !window->widget_close_allowed_ &&
        (!profile || window->ExistingBrowserFor(profile))) {
      return window;
    }
  }
  return nullptr;
}

namespace {

LinuxTab* AnyShownTabFor(LinuxWindow* window, Profile* profile) {
  for (content::WebContents* contents : window->TabsForProfile(profile)) {
    LinuxTab* tab = LinuxTab::ForContents(contents);
    if (tab && tab->visible()) {
      return tab;
    }
  }
  return nullptr;
}

LinuxTab* AnyTabIn(LinuxWindow* window) {
  for (content::WebContents* contents : window->AllTabs()) {
    if (LinuxTab* tab = LinuxTab::ForContents(contents)) {
      return tab;
    }
  }
  return nullptr;
}

LinuxTab* HostingTabFor(Profile* profile) {
  LinuxTab* any = nullptr;
  for (LinuxWindow* window : WindowsInActivationOrder()) {
    if (window->role() != LinuxWindow::Role::kApp || window->awaiting_app()) {
      continue;
    }
    if (LinuxTab* tab = profile ? AnyShownTabFor(window, profile) : nullptr) {
      return tab;
    }
    if (!any) {
      any = AnyTabIn(window);
    }
  }
  return profile && profile->IsOffTheRecord() ? nullptr : any;
}

void AnnounceStrayTab(base::WeakPtr<content::WebContents> contents, int tries) {
  if (!contents) {
    return;
  }
  const GURL& url = contents->GetVisibleURL();
  if ((url.is_empty() || url.IsAboutBlank()) && tries < 20) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE, base::BindOnce(&AnnounceStrayTab, contents, tries + 1),
        kAnnounceRetry);
    return;
  }
  base::DictValue request;
  request.Set("action", "open");
  request.Set("url", url.spec());
  request.Set("profile",
              ProfileName(Profile::FromBrowserContext(contents->GetBrowserContext())));
  request.Set("active", true);
  request.Set("window", base::Value());
  request.Set("extensionId", "");
  request.Set("adoptId", LinuxTab::OfferTab(contents.get(), "tab"));
  Bridge::Get().Emit("ArdiaExtensions", "onTabs",
                     base::Value(std::move(request)));
}

}

void LinuxWindow::HandOffTab(content::WebContents* contents) {
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  if (!profile) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](base::WeakPtr<content::WebContents> contents) {
                         if (contents) {
                           contents->ClosePage();
                         }
                       },
                       contents->GetWeakPtr()));
    return;
  }
  LinuxTab* view = HostingTabFor(profile);
  if (view || !profile->IsOffTheRecord()) {
    if (view && (view->profile_name() == ProfileName(profile) ||
                 IsOffTheRecordOf(profile, view->profile_name()))) {
      view->OpenedTab(contents, LinuxTab::OfferTab(contents, "tab"),
                      "foreground");
    } else {
      AnnounceStrayTab(contents->GetWeakPtr(), 0);
    }
    return;
  }
  view = HostingTabFor(nullptr);
  if (!view) {
    return;
  }
  view->OpenedTab(contents, LinuxTab::OfferTab(contents, "tab"), "incognito");
}

BrowserWindow* LinuxWindow::WindowForNewBrowser(Browser* browser) {
  if (LinuxBrowserWindow::IsOurs(browser) ||
      browser->GetType() == BrowserWindowInterface::TYPE_PICTURE_IN_PICTURE ||
      !HostStarted()) {
    return nullptr;
  }
  const std::string_view type = BrowserTypeName(browser->GetType());
  if (type != "normal" && type != "popup") {
    return nullptr;
  }
  Profile* profile = browser->GetProfile();
  LinuxWindow* window = nullptr;
  if (type == "normal" && !profile->IsOffTheRecord()) {
    auto made = std::make_unique<LinuxWindow>(Role::kChromeMade,
                                              gfx::Rect(kDefaultWindowSize));
    window = made.get();
    OwnedWindows().push_back(std::move(made));
    window->chrome_token_ = base::Uuid::GenerateRandomV4().AsLowercaseString();
    window->awaiting_app_ = true;
    ChromeMadeWindows()[window->chrome_token_] = window->GetWeakPtr();
    window->awaiting_app_timer_.Start(
        FROM_HERE, kAwaitAppTimeout,
        base::BindOnce(&LinuxWindow::StopAwaitingApp, window->GetWeakPtr()));
  } else {
    auto made = std::make_unique<LinuxWindow>(Role::kStray,
                                              gfx::Rect(kSmallWindowSize));
    window = made.get();
    OwnedWindows().push_back(std::move(made));
  }
  return window->HostChromeBrowser(browser);
}

void LinuxWindow::StopAwaitingApp() {
  if (!awaiting_app_) {
    return;
  }
  awaiting_app_ = false;
  ChromeMadeWindows().erase(chrome_token_);
  role_ = Role::kStray;
  std::vector<content::WebContents*> tabs = AllTabs();
  if (tabs.empty()) {
    Close();
    return;
  }
  for (content::WebContents* contents : tabs) {
    if (!LinuxTab::ForContents(contents)) {
      HandOffTab(contents);
    }
  }
}

void LinuxWindow::AnnounceChromeMadeTab(
    base::WeakPtr<content::WebContents> contents,
    int tries) {
  if (role_ == Role::kStray || !contents ||
      !std::ranges::contains(AllTabs(), contents.get())) {
    return;
  }
  LinuxTab* tab = LinuxTab::ForContents(contents.get());
  const std::string moving = tab ? tab->transfer_key() : std::string();
  const GURL& url = contents->GetVisibleURL();
  const bool blank = moving.empty() && (url.is_empty() || url.IsAboutBlank());
  if (blank && tries < 20) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&LinuxWindow::AnnounceChromeMadeTab, GetWeakPtr(),
                       contents, tries + 1),
        kAnnounceRetry);
    return;
  }
  base::DictValue request;
  request.Set("action", "open");
  request.Set("url", url.spec());
  request.Set("profile", ProfileName(Profile::FromBrowserContext(
                             contents->GetBrowserContext())));
  request.Set("active", !chrome_active_ || chrome_active_.get() == contents.get());
  request.Set("window", base::Value());
  request.Set("extensionId", "");
  request.Set("chromeWindow", chrome_token_);
  request.Set("focused", !show_inactive_requested_);
  if (!moving.empty()) {
    request.Set("tabKey", moving);
  } else if (tab) {
    return;
  } else {
    request.Set("adoptId", LinuxTab::OfferTab(contents.get(), "tab"));
  }
  announced_ = true;
  Bridge::Get().Emit("ArdiaExtensions", "onTabs",
                     base::Value(std::move(request)));
}

void LinuxWindow::CloseAll() {
  for (LinuxWindow* window : std::vector<LinuxWindow*>(Windows())) {
    window->Close();
  }
}

void LinuxWindow::DestroyAll() {
  std::vector<std::unique_ptr<LinuxWindow>> owned;
  owned.swap(OwnedWindows());
  for (std::unique_ptr<LinuxWindow>& window : owned) {
    WindowObservers().Notify(&Observer::OnWindowClosing, window.get());
  }
  owned.clear();
}

gfx::NativeWindow LinuxWindow::native_window() const {
  return widget_ ? widget_->GetNativeWindow() : gfx::NativeWindow();
}

gfx::NativeView LinuxWindow::native_view() const {
  return widget_ ? widget_->GetNativeView() : gfx::NativeView();
}

void LinuxWindow::AdoptShell(std::unique_ptr<content::WebContents> shell) {
  if (!shell || widget_close_allowed_ || !contents_view_) {
    return;
  }
  Observe(nullptr);
  if (shell_view_) {
    shell_view_->SetWebContents(nullptr);
  }
  shell_kept_visible_.RunAndReset();
  shell_ = std::move(shell);
  shell_ready_ = false;
  shell_->SetDelegate(this);
  shell_->SetSupportsDraggableRegions(true);
  shell_->SetPageBaseBackgroundColor(kWindowBackground);
  Observe(shell_.get());
  if (!shell_view_) {
    auto view = std::make_unique<views::WebView>(shell_->GetBrowserContext());
    shell_view_ = contents_view_->AddChildViewAt(std::move(view),
                                                 host_page_view_ ? 1 : 0);
    static_cast<ShellContentsView*>(contents_view_.get())
        ->set_shell_view(shell_view_);
  }
  shell_view_->SetWebContents(shell_.get());
  widget_delegate_->SetInitiallyFocusedView(shell_view_);
  if (!revealed_) {
    shell_kept_visible_ =
        shell_->IncrementCapturerCount(gfx::Size(), false, true, false);
    reveal_timer_.Start(FROM_HERE, kRevealTimeout,
                        base::BindOnce(&LinuxWindow::Reveal, GetWeakPtr()));
  }
  contents_view_->InvalidateLayout();
  WindowObservers().Notify(&Observer::OnWindowShellReady, this);
}

void LinuxWindow::RequestShellDocument() {
  if (role_ != Role::kApp || window_id_.empty()) {
    return;
  }
  OpenWindowDocument(this);
  if (!shell_ && !revealed_) {
    reveal_timer_.Start(FROM_HERE, kShellMissingTimeout,
                        base::BindOnce(&LinuxWindow::Reveal, GetWeakPtr()));
  }
}

void LinuxWindow::AnchorHostPage(content::WebContents* host) {
  if (!host || !contents_view_ || widget_close_allowed_) {
    return;
  }
  if (host_page_view_ && host_page_view_->GetWebContents() == host) {
    return;
  }
  ReleaseHostPage();
  auto view = std::make_unique<views::WebView>(host->GetBrowserContext());
  view->SetFocusBehavior(views::View::FocusBehavior::NEVER);
  view->SetCanProcessEventsWithinSubtree(false);
  host_page_view_ = contents_view_->AddChildViewAt(std::move(view), 0);
  host_page_view_->SetWebContents(host);
  static_cast<ShellContentsView*>(contents_view_.get())
      ->set_host_page_view(host_page_view_);
}

void LinuxWindow::ReleaseHostPage() {
  if (!host_page_view_ || !contents_view_) {
    host_page_view_ = nullptr;
    return;
  }
  static_cast<ShellContentsView*>(contents_view_.get())
      ->set_host_page_view(nullptr);
  host_page_view_->SetWebContents(nullptr);
  views::WebView* view = host_page_view_;
  host_page_view_ = nullptr;
  contents_view_->RemoveChildViewT(view);
}

void LinuxWindow::DidFirstVisuallyNonEmptyPaint() {
  shell_ready_ = true;
  Reveal();
}

void LinuxWindow::PrimaryMainFrameRenderProcessGone(
    base::TerminationStatus status) {
  shell_ready_ = false;
}

void LinuxWindow::Reveal() {
  reveal_timer_.Stop();
  if (revealed_ || widget_close_allowed_ || role_ != Role::kApp) {
    return;
  }
  revealed_ = true;
  Show(reveal_focus_);
  shell_kept_visible_.RunAndReset();
}

void LinuxWindow::Show(bool focus) {
  if (!widget_ || widget_close_allowed_) {
    return;
  }
  if (role_ == Role::kApp && !revealed_) {
    reveal_focus_ = reveal_focus_ || focus;
    return;
  }
  if (Background() || !focus) {
    widget_->ShowInactive();
    return;
  }
  widget_->Show();
  widget_->Activate();
}

void LinuxWindow::ShowInactive() {
  if (widget_ && !widget_close_allowed_ && !widget_->IsVisible()) {
    widget_->ShowInactive();
  }
}

void LinuxWindow::Focus() {
  if (!widget_ || widget_close_allowed_) {
    return;
  }
  if (!revealed_ && role_ == Role::kApp) {
    reveal_focus_ = true;
    return;
  }
  if (widget_->IsMinimized()) {
    widget_->Restore();
  }
  Show(true);
}

void LinuxWindow::Minimize() {
  if (widget_) {
    widget_->Minimize();
  }
}

void LinuxWindow::Maximize() {
  if (widget_) {
    widget_->Maximize();
  }
}

void LinuxWindow::Restore() {
  if (widget_) {
    widget_->Restore();
  }
}

void LinuxWindow::ToggleMaximize() {
  if (!widget_) {
    return;
  }
  if (widget_->IsMaximized()) {
    widget_->Restore();
  } else {
    widget_->Maximize();
  }
}

void LinuxWindow::BeginUserMove() {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<LinuxWindow> window) {
                       views::Widget* widget = window ? window->widget() : nullptr;
                       if (!widget || window->can_close_widget() ||
                           widget->IsMaximized() || widget->IsFullscreen() ||
                           !widget->IsMoveLoopSupported() ||
                           !widget->IsMouseButtonDown()) {
                         return;
                       }
                       const gfx::Point cursor =
                           display::Screen::Get()->GetCursorScreenPoint();
                       const gfx::Vector2d offset =
                           cursor - widget->GetWindowBoundsInScreen().origin();
                       widget->PrepareForMoveLoop(
                           views::Widget::MoveLoopSource::kMouse);
                       widget->RunMoveLoop(
                           offset, views::Widget::MoveLoopSource::kMouse,
                           views::Widget::MoveLoopEscapeBehavior::kDontHide);
                     },
                     GetWeakPtr()));
}

void LinuxWindow::SetFullscreen(bool fullscreen) {
  if (!widget_ || widget_->IsFullscreen() == fullscreen) {
    return;
  }
  if (!fullscreen) {
    fullscreen_for_tab_ = false;
  }
  widget_->SetFullscreen(fullscreen);
}

bool LinuxWindow::IsFullscreen() const {
  return widget_ && widget_->IsFullscreen();
}

bool LinuxWindow::IsMaximized() const {
  return widget_ && widget_->IsMaximized();
}

bool LinuxWindow::IsMinimized() const {
  return widget_ && widget_->IsMinimized();
}

bool LinuxWindow::IsActive() const {
  return widget_ && widget_->IsActive();
}

bool LinuxWindow::IsVisible() const {
  return widget_ && widget_->IsVisible();
}

void LinuxWindow::SetBounds(const gfx::Rect& bounds) {
  if (widget_ && !bounds.IsEmpty()) {
    widget_->SetBounds(bounds);
  }
}

gfx::Rect LinuxWindow::GetBounds() const {
  return widget_ ? widget_->GetWindowBoundsInScreen() : gfx::Rect();
}

gfx::Rect LinuxWindow::GetRestoredBounds() const {
  return widget_ ? widget_->GetRestoredBounds() : gfx::Rect();
}

void LinuxWindow::SetTitle(const std::u16string& title) {
  if (title_ == title) {
    return;
  }
  title_ = title;
  if (widget_delegate_) {
    widget_delegate_->SetTitle(title);
  }
}

void LinuxWindow::SetMinimumSize(const gfx::Size& size) {
  minimum_size_ = size;
  if (contents_view_) {
    static_cast<ShellContentsView*>(contents_view_.get())->set_minimum(size);
  }
  if (widget_) {
    widget_->OnSizeConstraintsChanged();
  }
}

void LinuxWindow::CloseRequestedByUser() {
  if (close_state_ != CloseState::kOpen) {
    return;
  }
  if (CloseRequests() && !CloseRequests().Run(this)) {
    return;
  }
  Close();
}

void LinuxWindow::Close() {
  if (close_state_ != CloseState::kOpen) {
    return;
  }
  close_state_ = CloseState::kAsking;
  ++close_attempt_;
  ContinueClose();
}

void LinuxWindow::ContinueCloseAttempt(int attempt) {
  if (attempt != close_attempt_ || browser_shutdown::IsTryingToQuit()) {
    return;
  }
  ContinueClose();
}

void LinuxWindow::ContinueClose() {
  if (close_state_ != CloseState::kAsking) {
    return;
  }
  asking_ = nullptr;
  for (Browser* browser : browsers()) {
    if (UnloadController::From(browser)->TryToCloseWindow(
            false, base::BindRepeating(&LinuxWindow::OnBeforeUnloadAnswered,
                                       GetWeakPtr()))) {
      asking_ = browser;
      return;
    }
  }
  const int downloads = DownloadsCancelledByClose();
  if (downloads > 0) {
    ConfirmCloseWithDownloads(
        downloads,
        base::BindOnce(
            [](base::WeakPtr<LinuxWindow> window, bool close_anyway) {
              if (!window || window->close_state_ != CloseState::kAsking) {
                return;
              }
              if (close_anyway) {
                window->CommitClose();
              } else {
                window->CancelClose();
              }
            },
            GetWeakPtr()));
    return;
  }
  CommitClose();
}

void LinuxWindow::OnBeforeUnloadAnswered(bool proceed) {
  if (close_state_ != CloseState::kAsking) {
    return;
  }
  asking_ = nullptr;
  if (proceed) {
    ContinueClose();
  } else {
    CancelClose();
  }
}

void LinuxWindow::CancelClose() {
  close_state_ = CloseState::kOpen;
  asking_ = nullptr;
  ++close_attempt_;
  for (Browser* browser : browsers()) {
    UnloadController::From(browser)->ResetTryToCloseWindow();
  }
  NotifyCloseCancelled();
}

void LinuxWindow::NotifyCloseCancelled() {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<LinuxWindow> window) {
                       if (window) {
                         LOG(WARNING) << "[ardiacore] window close cancelled";
                         WindowObservers().Notify(
                             &Observer::OnWindowCloseCancelled, window.get());
                       }
                     },
                     GetWeakPtr()));
}

void LinuxWindow::QuitCancelled() {
  if (close_state_ == CloseState::kAsking) {
    close_state_ = CloseState::kOpen;
    asking_ = nullptr;
    ++close_attempt_;
    for (Browser* browser : browsers()) {
      UnloadController::From(browser)->ResetTryToCloseWindow();
    }
  }
  NotifyCloseCancelled();
}

void LinuxWindow::CommitClose() {
  close_state_ = CloseState::kClosing;
  WindowObservers().Notify(&Observer::OnWindowClosing, this);
  if (browsers_.empty()) {
    CloseWidget();
    return;
  }
  for (Browser* browser : browsers()) {
    browser->GetWindow()->Close();
  }
}

void LinuxWindow::CloseWidget() {
  if (deletion_scheduled_) {
    return;
  }
  deletion_scheduled_ = true;
  widget_close_allowed_ = true;
  if (!chrome_token_.empty()) {
    ChromeMadeWindows().erase(chrome_token_);
  }
  if (widget_ && !widget_->IsClosed()) {
    widget_->Close();
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](LinuxWindow* window) {
                       auto& owned = OwnedWindows();
                       auto it = std::ranges::find_if(
                           owned, [&](const std::unique_ptr<LinuxWindow>& w) {
                             return w.get() == window;
                           });
                       if (it != owned.end()) {
                         std::unique_ptr<LinuxWindow> gone = std::move(*it);
                         owned.erase(it);
                       }
                     },
                     base::Unretained(this)));
}

int LinuxWindow::DownloadsCancelledByClose() const {
  int count = 0;
  for (const auto& [profile, browser] : browsers_) {
    if (!profile->IsOffTheRecord()) {
      continue;
    }
    bool other_window = false;
    GlobalBrowserCollection::GetInstance()->ForEach(
        [&](BrowserWindowInterface* other) {
          if (other->GetProfile() == profile && ForBrowser(other) != this &&
              !other->capabilities()->IsAttemptingToCloseBrowser()) {
            other_window = true;
          }
          return !other_window;
        });
    DownloadCoreService* downloads =
        DownloadCoreServiceFactory::GetForBrowserContext(profile);
    if (!other_window && downloads) {
      count += downloads->BlockingShutdownCount();
    }
  }
  return count;
}

void LinuxWindow::ConfirmCloseWithDownloads(
    int count,
    base::OnceCallback<void(bool)> callback) {
  auto reply = base::BindOnce(
      [](base::OnceCallback<void(bool)> callback, bool close_anyway) {
        base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
            FROM_HERE, base::BindOnce(std::move(callback), close_anyway));
      },
      std::move(callback));
  if (!DownloadsConfirms()) {
    std::move(reply).Run(true);
    return;
  }
  DownloadsConfirms().Run(this, count, std::move(reply));
}

void LinuxWindow::BrowserWindowDestroyed(LinuxBrowserWindow* window) {
  const bool was_asking = asking_ && window->browser() == asking_;
  if (was_asking) {
    asking_ = nullptr;
  }
  for (auto it = browsers_.begin(); it != browsers_.end(); ++it) {
    if (it->second == window->browser()) {
      it->second->GetTabStripModel()->RemoveObserver(this);
      if (active_profile_ == it->first) {
        active_profile_ = nullptr;
      }
      browsers_.erase(it);
      break;
    }
  }
  if (browsers_.empty() && (closing() || browser_shutdown::IsTryingToQuit())) {
    close_state_ = CloseState::kClosing;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&LinuxWindow::CloseWidget, GetWeakPtr()));
  } else if (was_asking && close_state_ == CloseState::kAsking &&
             !browser_shutdown::IsTryingToQuit()) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&LinuxWindow::ContinueCloseAttempt,
                                  GetWeakPtr(), close_attempt_));
  }
}

Browser* LinuxWindow::ExistingBrowserFor(Profile* profile) const {
  auto it = browsers_.find(profile);
  return it == browsers_.end() ? nullptr : it->second.get();
}

std::vector<Browser*> LinuxWindow::browsers() const {
  std::vector<Browser*> list;
  for (const auto& [profile, browser] : browsers_) {
    list.push_back(browser.get());
  }
  return list;
}

Browser* LinuxWindow::BrowserFor(Profile* profile) {
  if (!profile) {
    return nullptr;
  }
  if (Browser* browser = ExistingBrowserFor(profile)) {
    return browser;
  }
  if (ProfileUnusable(profile) || close_state_ != CloseState::kOpen ||
      !widget_ || widget_close_allowed_ || browser_shutdown::IsTryingToQuit() ||
      GetBrowserWindowCreationStatusForProfile(*profile) !=
          BrowserWindowInterface::CreationStatus::kOk) {
    return nullptr;
  }
  auto* window = new LinuxBrowserWindow(GetWeakPtr());
  BrowserWindowCreateParams params(BrowserWindowInterface::TYPE_NORMAL,
                                   *profile, true);
  params.window = window;
  params.omit_from_session_restore = true;
  params.should_trigger_session_restore = false;
  Browser* browser =
      static_cast<Browser*>(CreateBrowserWindow(std::move(params)));
  window->AttachBrowser(browser);
  AddBrowser(browser);
  return browser;
}

BrowserWindow* LinuxWindow::HostChromeBrowser(Browser* browser) {
  Profile* profile = browser->GetProfile();
  if (LinuxBrowserWindow::IsOurs(browser) || close_state_ != CloseState::kOpen ||
      widget_close_allowed_ || ExistingBrowserFor(profile)) {
    return nullptr;
  }
  auto* window = new LinuxBrowserWindow(GetWeakPtr());
  window->AttachBrowser(browser);
  AddBrowser(browser);
  return window;
}

void LinuxWindow::AddBrowser(Browser* browser) {
  Profile* profile = browser->GetProfile();
  browsers_[profile] = browser;
  if (auto* elements = BrowserElements::From(browser)) {
    if (auto* views_elements = elements->AsA<BrowserElementsViewsImpl>()) {
      views_elements->Init(widget_->GetRootView());
    }
  }
  browser->GetTabStripModel()->AddObserver(this);
  if (!active_profile_) {
    SetActiveProfile(profile);
  }
}

void LinuxWindow::SetActiveProfile(Profile* profile) {
  if (active_profile_ == profile) {
    return;
  }
  Browser* old_browser =
      active_profile_ ? ExistingBrowserFor(active_profile_) : nullptr;
  active_profile_ = profile;
  if (old_browser) {
    BrowserActiveStateManager::From(old_browser)->DidBecomeInactive();
  }
  if (Browser* browser = ExistingBrowserFor(profile)) {
    NoteHostActivated(browser);
  }
}

void LinuxWindow::ShowProfile(const std::string& profile) {
  WithProfile(profile, base::BindOnce(
                           [](base::WeakPtr<LinuxWindow> window, Profile* p) {
                             if (!window || !p) {
                               return;
                             }
                             window->BrowserFor(p);
                             window->SetActiveProfile(p);
                             Browser* browser = window->ExistingBrowserFor(p);
                             content::WebContents* active =
                                 browser ? browser->GetTabStripModel()
                                               ->GetActiveWebContents()
                                         : nullptr;
                             if (LinuxTab* tab = LinuxTab::ForContents(active)) {
                               tab->RequestFocusRestore();
                             }
                           },
                           GetWeakPtr()));
}

void LinuxWindow::PrepareProfiles(const std::vector<std::string>& profiles) {
  for (const std::string& profile : profiles) {
    WithProfile(profile, base::BindOnce(
                             [](base::WeakPtr<LinuxWindow> window, Profile* p) {
                               if (window && p) {
                                 window->BrowserFor(p);
                               }
                             },
                             GetWeakPtr()));
  }
}

bool LinuxWindow::IsActiveBrowser(const Browser* browser) const {
  return browser && active_profile_ &&
         ExistingBrowserFor(active_profile_) == browser;
}

bool LinuxWindow::IsUsersWindow() {
  if (internal_ || !widget_ || role_ != Role::kApp) {
    return false;
  }
  if (widget_->IsActive()) {
    return true;
  }
  for (LinuxWindow* window : Windows()) {
    if (window->widget_ && window->widget_->IsActive()) {
      return false;
    }
  }
  if (!LastUsersWindow()) {
    LastUsersWindow() = GetWeakPtr();
  }
  return LastUsersWindow().get() == this;
}

void LinuxWindow::NoteHostActivated(Browser* browser) {
  if (!IsActiveBrowser(browser) || !IsUsersWindow()) {
    return;
  }
  if (GlobalBrowserCollection::GetInstance()->GetLastActiveBrowser() == browser &&
      ProfileManager::GetLastUsedProfileIfLoaded() == browser->GetProfile()) {
    return;
  }
  ActivateExclusively(browser);
}

void LinuxWindow::RequestActivation(Browser* browser) {
  if (internal_ || !widget_ || !widget_->IsVisible() ||
      ExistingBrowserFor(browser->GetProfile()) != browser || Background()) {
    return;
  }
  if (IsActiveBrowser(browser)) {
    Show(true);
    return;
  }
  content::WebContents* contents =
      browser->GetTabStripModel()->GetActiveWebContents();
  if (contents) {
    TabRequestsActivation(contents, "window");
  }
}

void LinuxWindow::ShowRequested(bool active) {
  if (awaiting_app_) {
    show_inactive_requested_ = !active;
  }
}

content::WebContents* LinuxWindow::OpenTab(const GURL& url,
                                           Profile* profile,
                                           bool foreground) {
  Browser* browser = BrowserFor(profile);
  if (!browser) {
    return nullptr;
  }
  const bool ahead = url.is_empty();
  NavigateParams params(browser, ahead ? GURL(url::kAboutBlankURL) : url,
                        ui::PAGE_TRANSITION_TYPED);
  params.disposition = foreground ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                                  : WindowOpenDisposition::NEW_BACKGROUND_TAB;
  params.window_action = NavigateParams::WindowAction::kNoAction;
  base::AutoReset<PendingOpen> pending(&pending_open_,
                                       PendingOpen{params.disposition, nullptr});
  Navigate(&params);
  content::WebContents* contents = params.navigated_or_inserted_contents;
  if (contents && ahead) {
    MarkTabMadeAhead(contents);
    ardiacore::MarkAheadBlank(contents);
  }
  return contents;
}

void LinuxWindow::ActivateTab(content::WebContents* contents) {
  if (IsNotifyingTabStrip()) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(
            [](base::WeakPtr<LinuxWindow> window,
               base::WeakPtr<content::WebContents> contents) {
              if (window && contents) {
                window->ActivateTab(contents.get());
              }
            },
            GetWeakPtr(), contents ? contents->GetWeakPtr() : nullptr));
    return;
  }
  if (!contents) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  if (!browser) {
    return;
  }
  NoteHostActivated(static_cast<Browser*>(browser));
  TabStripModel* model = browser->GetTabStripModel();
  int index = model->GetIndexOfWebContents(contents);
  if (index != TabStripModel::kNoTab && index != model->active_index()) {
    model->ActivateTabAt(index);
  }
}

std::vector<content::WebContents*> LinuxWindow::TabsForProfile(
    Profile* profile) const {
  std::vector<content::WebContents*> tabs;
  Browser* browser = profile ? ExistingBrowserFor(profile) : nullptr;
  if (!browser) {
    return tabs;
  }
  TabStripModel* model = browser->GetTabStripModel();
  for (int i = 0; i < model->count(); ++i) {
    tabs.push_back(model->GetWebContentsAt(i));
  }
  return tabs;
}

std::vector<content::WebContents*> LinuxWindow::AllTabs() const {
  std::vector<content::WebContents*> tabs;
  for (const auto& [profile, browser] : browsers_) {
    std::vector<content::WebContents*> some = TabsForProfile(profile);
    tabs.insert(tabs.end(), some.begin(), some.end());
  }
  return tabs;
}

int LinuxWindow::ChromeWindowIdForProfile(Profile* profile) const {
  Browser* browser = ExistingBrowserFor(profile);
  return browser ? browser->GetSessionID().id() : -1;
}

bool LinuxWindow::ExecuteChromeCommand(int command_id, Profile* profile) {
  Browser* browser = ExistingBrowserFor(profile);
  return browser && chrome::ExecuteCommand(browser, command_id);
}

void LinuxWindow::AdoptTab(content::WebContents* contents) {
  if (IsNotifyingTabStrip()) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(
            [](base::WeakPtr<LinuxWindow> window,
               base::WeakPtr<content::WebContents> contents) {
              if (window && contents) {
                window->AdoptTab(contents.get());
              }
            },
            GetWeakPtr(), contents ? contents->GetWeakPtr() : nullptr));
    return;
  }
  if (!contents) {
    return;
  }
  BrowserWindowInterface* from =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  Browser* to =
      BrowserFor(Profile::FromBrowserContext(contents->GetBrowserContext()));
  if (!from || !to || from == to) {
    return;
  }
  TabStripModel* source = from->GetTabStripModel();
  const int index = source->GetIndexOfWebContents(contents);
  if (index == TabStripModel::kNoTab) {
    return;
  }
  base::AutoReset<int> changing(&host_changes_, host_changes_ + 1);
  std::unique_ptr<tabs::TabModel> moved = source->DetachTabAtForInsertion(index);
  if (!moved) {
    return;
  }
  TabStripModel* target = to->GetTabStripModel();
  target->InsertDetachedTabAt(target->count(), std::move(moved),
                              AddTabTypes::ADD_NONE);
}

void LinuxWindow::PlaceTab(content::WebContents* contents,
                           int index,
                           bool pinned) {
  if (IsNotifyingTabStrip()) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(
            [](base::WeakPtr<LinuxWindow> window,
               base::WeakPtr<content::WebContents> contents, int index,
               bool pinned) {
              if (window && contents) {
                window->PlaceTab(contents.get(), index, pinned);
              }
            },
            GetWeakPtr(), contents ? contents->GetWeakPtr() : nullptr, index,
            pinned));
    return;
  }
  if (!contents) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  if (!browser || ForBrowser(browser) != this) {
    return;
  }
  TabStripModel* model = browser->GetTabStripModel();
  int at = model->GetIndexOfWebContents(contents);
  if (at == TabStripModel::kNoTab) {
    return;
  }
  if (model->IsTabPinned(at) != pinned) {
    at = model->SetTabPinned(at, pinned);
  }
  const int pinned_count = model->IndexOfFirstNonPinnedTab();
  int to = std::clamp(index, 0, model->count() - 1);
  to = pinned ? std::min(to, pinned_count - 1) : std::max(to, pinned_count);
  if (to != at) {
    model->MoveWebContentsAt(at, to, false);
  }
}

content::WebContents* LinuxWindow::RestoreTab(const std::string& state,
                                              Profile* profile,
                                              bool foreground) {
  if (IsNotifyingTabStrip()) {
    return nullptr;
  }
  std::optional<std::vector<uint8_t>> bytes = base::Base64Decode(state);
  Browser* browser = profile ? BrowserFor(profile) : nullptr;
  if (!bytes || bytes->empty() || !browser) {
    return nullptr;
  }
  base::Pickle pickle = base::Pickle::WithUnownedBuffer(*bytes);
  base::PickleIterator it(pickle);
  int version = 0;
  int selected = 0;
  int count = 0;
  if (!it.ReadInt(&version) || version != 1 || !it.ReadInt(&selected) ||
      !it.ReadInt(&count) || count <= 0 || count > 1000) {
    return nullptr;
  }
  std::vector<sessions::SerializedNavigationEntry> navigations;
  for (int i = 0; i < count; ++i) {
    sessions::SerializedNavigationEntry entry;
    if (!entry.ReadFromPickle(&it)) {
      return nullptr;
    }
    navigations.push_back(std::move(entry));
  }
  selected = std::clamp(selected, 0, count - 1);
  base::AutoReset<PendingOpen> pending(
      &pending_open_,
      PendingOpen{foreground ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                             : WindowOpenDisposition::NEW_BACKGROUND_TAB,
                  nullptr});
  return chrome::AddRestoredTab(
      browser, navigations, browser->GetTabStripModel()->count(), selected,
      std::string(), std::nullopt, foreground, false, base::TimeTicks::Now(),
      base::Time::Now(), nullptr, sessions::SerializedUserAgentOverride(), {},
      false, std::nullopt);
}

content::WebContents* LinuxWindow::DuplicateTab(content::WebContents* source,
                                                Profile* profile,
                                                bool foreground) {
  if (IsNotifyingTabStrip() || !source || !profile ||
      Profile::FromBrowserContext(source->GetBrowserContext()) != profile) {
    return nullptr;
  }
  Browser* browser = BrowserFor(profile);
  if (!browser) {
    return nullptr;
  }
  std::unique_ptr<content::WebContents> copy = source->Clone();
  content::WebContents* raw = copy.get();
  base::AutoReset<PendingOpen> pending(
      &pending_open_,
      PendingOpen{foreground ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                             : WindowOpenDisposition::NEW_BACKGROUND_TAB,
                  source->GetWeakPtr()});
  TabStripModel* model = browser->GetTabStripModel();
  model->InsertWebContentsAt(
      model->count(), std::move(copy),
      foreground ? AddTabTypes::ADD_ACTIVE : AddTabTypes::ADD_NONE);
  return raw;
}

void LinuxWindow::NoteClosing(content::WebContents* contents) {
  if (!contents) {
    return;
  }
  closing_tabs_.push_back(contents->GetWeakPtr());
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE,
      base::BindOnce(
          [](base::WeakPtr<LinuxWindow> window,
             base::WeakPtr<content::WebContents> contents) {
            if (window) {
              std::erase_if(window->closing_tabs_,
                            [&](const base::WeakPtr<content::WebContents>& c) {
                              return !c || c.get() == contents.get();
                            });
            }
          },
          GetWeakPtr(), contents->GetWeakPtr()),
      kClosingMemory);
}

bool LinuxWindow::app_changing() const {
  if (host_changes_ > 0) {
    return true;
  }
  return std::ranges::any_of(
      closing_tabs_,
      [](const base::WeakPtr<content::WebContents>& c) { return !!c; });
}

void LinuxWindow::ActiveTabChanged(Browser* browser,
                                   content::WebContents* contents) {
  if (!contents) {
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&ardiacore::ShowWaitingInstalledBubbles));
  base::AutoReset<int> notifying(&g_tab_strip_notifying,
                                 g_tab_strip_notifying + 1);
  if (awaiting_app_) {
    chrome_active_ = contents->GetWeakPtr();
  }
  WindowObservers().Notify(&Observer::OnWindowTabActivated, this, contents);
  if (LinuxTab* tab = LinuxTab::ForContents(contents)) {
    tab->TabActivatedByChrome(!app_changing());
  }
}

void LinuxWindow::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  base::AutoReset<int> notifying(&g_tab_strip_notifying,
                                 g_tab_strip_notifying + 1);
  if (change.type() == TabStripModelChange::kInserted) {
    for (const auto& inserted : change.GetInsert()->contents) {
      content::WebContents* contents = inserted.contents;
      ardiacore::TrackAutofillFocus(contents);
      TabInsertedInWindow(contents);
      std::optional<WindowOpenDisposition> disposition =
          TakeOpenDisposition(contents);
      content::WebContents* source = OpenSourceOf(contents);
      if (!disposition && pending_open_.disposition) {
        disposition = pending_open_.disposition;
        source = pending_open_.source.get();
        NoteOpen(contents, *disposition, source);
      }
      if (!source) {
        tabs::TabInterface* opener_tab =
            tab_strip_model->GetOpenerOfTabAt(inserted.index);
        source = opener_tab ? opener_tab->GetContents() : nullptr;
      }
      if (!disposition) {
        disposition = tab_strip_model->active_index() == inserted.index
                          ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                          : WindowOpenDisposition::NEW_BACKGROUND_TAB;
      }
      TabInserted(contents, source, DispositionName(*disposition));
    }
  } else if (change.type() == TabStripModelChange::kRemoved) {
    for (const auto& removed : change.GetRemove()->contents) {
      if (!removed.contents) {
        continue;
      }
      Browser* browser = nullptr;
      for (Browser* b : browsers()) {
        if (b->GetTabStripModel() == tab_strip_model) {
          browser = b;
        }
      }
      LinuxBrowserWindow* browser_window =
          browser ? LinuxBrowserWindow::FromWindow(
                        BrowserWindow::FromBrowser(browser))
                  : nullptr;
      const bool browser_closing =
          !browser ||
          (UnloadController::From(browser)->is_attempting_to_close_browser() &&
           !(browser_window && browser_window->closed_by_chrome()));
      if (removed.remove_reason == TabRemovedReason::kDeleted &&
          !browser_closing && !closing() &&
          !browser_shutdown::IsTryingToQuit()) {
        TabWillClose(removed.contents);
      }
      TabRemoved(removed.contents);
    }
  }
}

void LinuxWindow::TabInserted(content::WebContents* contents,
                              content::WebContents* opener,
                              std::string_view disposition) {
  WindowObservers().Notify(&Observer::OnWindowTabInserted, this, contents,
                           opener, disposition);
  if (host_changes_ > 0) {
    return;
  }
  if (awaiting_app_) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&LinuxWindow::AnnounceChromeMadeTab,
                                  GetWeakPtr(), contents->GetWeakPtr(), 0));
    return;
  }
  if (LinuxTab::ForContents(contents)) {
    return;
  }
  if (role_ == Role::kStray) {
    HandOffTab(contents);
    return;
  }
  if (role_ == Role::kPopup) {
    if (contents == popup_tab_.get()) {
      return;
    }
    LinuxTab* opener_view = LinuxTab::ForContents(popup_opener_.get());
    if (disposition == "popup") {
      OpenPopupWindow(contents, opener_view ? popup_opener_.get() : nullptr);
      return;
    }
    LinuxTab* view =
        opener_view ? opener_view
                    : HostingTabFor(Profile::FromBrowserContext(
                          contents->GetBrowserContext()));
    if (view) {
      view->OpenedTab(contents, LinuxTab::OfferTab(contents, "ardiacore"),
                      AppDisposition(disposition));
    } else {
      contents->ClosePage();
    }
    return;
  }
  LinuxTab* opener_view = LinuxTab::ForContents(opener);
  if (disposition == "popup") {
    OpenPopupWindow(contents, opener_view ? opener : nullptr);
    return;
  }
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  if (opener_view) {
    opener_view->OpenedTab(contents, LinuxTab::OfferTab(contents, "ardiacore"),
                           AppDisposition(disposition));
  } else if (LinuxTab* view = AnyShownTabFor(this, profile)) {
    view->OpenedTab(contents, LinuxTab::OfferTab(contents, "tab"), "foreground");
  } else {
    HandOffTab(contents);
  }
}

void LinuxWindow::TabRemoved(content::WebContents* contents) {
  WindowObservers().Notify(&Observer::OnWindowTabRemoved, this, contents);
  if (LinuxTab* tab = LinuxTab::ForContents(contents)) {
    tab->TabRemovedFromWindow(this);
  }
  if (role_ == Role::kPopup && contents == popup_tab_.get()) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&LinuxWindow::Close, GetWeakPtr()));
  } else if (role_ == Role::kStray || role_ == Role::kStandalone ||
             awaiting_app_) {
    CloseIfEmptyLater(Profile::FromBrowserContext(contents->GetBrowserContext()));
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE,
      base::BindOnce(
          [](base::WeakPtr<LinuxWindow> window) {
            if (window) {
              std::erase_if(window->closing_tabs_,
                            [](const base::WeakPtr<content::WebContents>& c) {
                              return !c;
                            });
            }
          },
          GetWeakPtr()));
}

void LinuxWindow::CloseIfEmptyLater(Profile* removed_profile) {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE,
      base::BindOnce(
          [](base::WeakPtr<LinuxWindow> window) {
            if (!window || !window->AllTabs().empty()) {
              return;
            }
            if (window->awaiting_app_) {
              window->awaiting_app_ = false;
              window->awaiting_app_timer_.Stop();
              ChromeMadeWindows().erase(window->chrome_token_);
              if (window->announced_) {
                base::DictValue request;
                request.Set("action", "closeWindow");
                request.Set("chromeWindow", window->chrome_token_);
                Bridge::Get().Emit("ArdiaExtensions", "onTabs",
                                   base::Value(std::move(request)));
              }
            } else if (window->role_ != Role::kStray &&
                       window->role_ != Role::kStandalone) {
              return;
            }
            if (window->role_ == Role::kStandalone) {
              std::erase_if(StandaloneWindows(), [&](const auto& entry) {
                return entry.second.get() == window.get();
              });
            }
            window->Close();
          },
          GetWeakPtr()));
}

void LinuxWindow::OpenPopupWindow(content::WebContents* contents,
                                  content::WebContents* opener) {
  std::optional<base::DictValue> features = PopupFeaturesOf(contents);
  const int width = std::max(
      features && features->FindInt("width") ? *features->FindInt("width") : 500,
      200);
  const int height = std::max(
      features && features->FindInt("height") ? *features->FindInt("height")
                                              : 600,
      150);
  auto made =
      std::make_unique<LinuxWindow>(Role::kPopup, gfx::Rect(width, height));
  LinuxWindow* popup = made.get();
  OwnedWindows().push_back(std::move(made));
  popup->popup_opener_ = opener ? opener->GetWeakPtr() : nullptr;
  LinuxWindow* parent = ForTab(opener);
  gfx::Rect bounds(width, height);
  if (features && (features->FindInt("x") || features->FindInt("y"))) {
    const gfx::Rect parent_bounds =
        parent ? parent->GetBounds() : gfx::Rect(kDefaultWindowSize);
    bounds.set_x(features->FindInt("x").value_or(
        parent_bounds.CenterPoint().x() - width / 2));
    bounds.set_y(features->FindInt("y").value_or(parent_bounds.y() + 60));
    popup->SetBounds(bounds);
  } else if (parent) {
    const gfx::Rect parent_bounds = parent->GetBounds();
    bounds.set_x(parent_bounds.CenterPoint().x() - width / 2);
    bounds.set_y(parent_bounds.y() + 60);
    popup->SetBounds(bounds);
  } else {
    popup->widget_->CenterWindow(bounds.size());
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&LinuxWindow::TakePopupTab, popup->GetWeakPtr(),
                                contents->GetWeakPtr()));
}

void LinuxWindow::TakePopupTab(base::WeakPtr<content::WebContents> contents) {
  if (!contents) {
    Close();
    return;
  }
  popup_tab_ = contents;
  {
    base::AutoReset<int> changing(&host_changes_, host_changes_ + 1);
    AdoptTab(contents.get());
  }
  if (Profile* profile =
          Profile::FromBrowserContext(contents->GetBrowserContext())) {
    SetActiveProfile(profile);
  }
  if (!contents_view_) {
    return;
  }
  if (!shell_view_) {
    auto view = std::make_unique<views::WebView>(contents->GetBrowserContext());
    shell_view_ = contents_view_->AddChildViewAt(std::move(view), 0);
    static_cast<ShellContentsView*>(contents_view_.get())
        ->set_shell_view(shell_view_);
  }
  shell_view_->SetWebContents(contents.get());
  Observe(contents.get());
  UpdatePopupTitle();
  revealed_ = true;
  Show(true);
  contents->Focus();
}

void LinuxWindow::UpdatePopupTitle() {
  content::WebContents* contents = popup_tab_.get();
  if (!contents) {
    return;
  }
  const GURL& url = contents->GetVisibleURL();
  const std::u16string host = base::UTF8ToUTF16(url.host());
  const std::u16string& title = contents->GetTitle();
  SetTitle(!title.empty() && title != base::UTF8ToUTF16(url.spec()) ? title
                                                                    : host);
}

void LinuxWindow::TitleWasSet(content::NavigationEntry* entry) {
  if (role_ == Role::kPopup) {
    UpdatePopupTitle();
  }
}

void LinuxWindow::DevToolsDockChanged(content::WebContents* inspected,
                                      content::WebContents* devtools) {
  if (LinuxTab* tab = LinuxTab::ForContents(inspected)) {
    tab->DevToolsChanged(devtools);
  }
}

bool LinuxWindow::OfferPasswordSave(content::WebContents* contents) {
  LinuxTab* tab = LinuxTab::ForContents(contents);
  if (!tab || !PasswordPrompts()) {
    return false;
  }
  std::optional<base::DictValue> prompt = PasswordPrompts().Run(contents);
  if (!prompt) {
    return false;
  }
  ardiacore::PasswordPromptShown(contents);
  tab->Emit("passwordPrompt", std::move(*prompt));
  ardiacore::PasswordConfirmationShown(contents);
  return true;
}

void LinuxWindow::FullscreenChanged(content::WebContents* contents,
                                    bool fullscreen) {
  if (!contents) {
    return;
  }
  if (role_ == Role::kApp) {
    if (fullscreen && !IsFullscreen()) {
      fullscreen_for_tab_ = true;
      widget_->SetFullscreen(true);
    } else if (!fullscreen && fullscreen_for_tab_ && !acted_fullscreen_) {
      fullscreen_for_tab_ = false;
      widget_->SetFullscreen(false);
    }
  }
  if (LinuxTab* tab = LinuxTab::ForContents(contents)) {
    base::DictValue payload;
    payload.Set("fullscreen", fullscreen);
    tab->Emit("fullscreen", std::move(payload));
  }
}

bool LinuxWindow::PreHandleKey(const input::NativeWebKeyboardEvent& event) {
  if (role_ == Role::kPopup) {
    const int modifiers = event.GetModifiers();
    if (event.windows_key_code == ui::VKEY_W &&
        (modifiers & blink::WebInputEvent::kControlKey) &&
        !(modifiers & (blink::WebInputEvent::kAltKey |
                       blink::WebInputEvent::kShiftKey))) {
      Close();
      return true;
    }
  }
  return Keys() && Keys().Run(this, event, true);
}

bool LinuxWindow::HandleKey(content::WebContents* source,
                            const input::NativeWebKeyboardEvent& event) {
  if (event.skip_if_unhandled ||
      event.GetType() == input::NativeWebKeyboardEvent::Type::kChar) {
    return false;
  }
  const int modifiers = event.GetModifiers();
  if (event.GetType() == input::NativeWebKeyboardEvent::Type::kRawKeyDown &&
      event.windows_key_code == ui::VKEY_ESCAPE &&
      !(modifiers & (blink::WebInputEvent::kMetaKey |
                     blink::WebInputEvent::kAltKey |
                     blink::WebInputEvent::kControlKey))) {
    LinuxTab* target = nullptr;
    for (content::WebContents* contents : AllTabs()) {
      LinuxTab* tab = LinuxTab::ForContents(contents);
      if (tab && tab->visible() && contents == source) {
        target = tab;
      }
    }
    if (target) {
      base::DictValue payload;
      payload.Set("command", "escape");
      payload.Set("text", "");
      target->Emit("command", std::move(payload));
    }
  }
  if (Keys() && Keys().Run(this, event, false)) {
    return true;
  }
  if (!widget_) {
    return false;
  }
  views::UnhandledKeyboardEventHandler handler;
  return handler.HandleKeyboardEvent(event, widget_->GetFocusManager());
}

content::WebContents* LinuxWindow::OpenURLFromTab(
    content::WebContents* source,
    const content::OpenURLParams& params,
    base::OnceCallback<void(content::NavigationHandle&)>
        navigation_handle_callback) {
  return nullptr;
}

content::KeyboardEventProcessingResult LinuxWindow::PreHandleKeyboardEvent(
    content::WebContents* source,
    const input::NativeWebKeyboardEvent& event) {
  if (event.GetType() == input::NativeWebKeyboardEvent::Type::kRawKeyDown &&
      PreHandleKey(event)) {
    return content::KeyboardEventProcessingResult::HANDLED;
  }
  return content::KeyboardEventProcessingResult::NOT_HANDLED;
}

bool LinuxWindow::HandleKeyboardEvent(
    content::WebContents* source,
    const input::NativeWebKeyboardEvent& event) {
  if (role_ == Role::kPopup) {
    return HandleKey(source, event);
  }
  if (event.skip_if_unhandled ||
      event.GetType() == input::NativeWebKeyboardEvent::Type::kChar) {
    return false;
  }
  if (Keys() && Keys().Run(this, event, false)) {
    return true;
  }
  if (!widget_) {
    return false;
  }
  views::UnhandledKeyboardEventHandler handler;
  return handler.HandleKeyboardEvent(event, widget_->GetFocusManager());
}

void LinuxWindow::DraggableRegionsChanged(
    const std::vector<blink::mojom::DraggableRegionPtr>& regions,
    content::WebContents* contents) {
  if (contents != shell_.get()) {
    return;
  }
  SkRegion region;
  for (const blink::mojom::DraggableRegionPtr& item : regions) {
    const gfx::Rect& r = item->bounds;
    region.op(SkIRect::MakeLTRB(r.x(), r.y(), r.right(), r.bottom()),
              item->draggable ? SkRegion::kUnion_Op : SkRegion::kDifference_Op);
  }
  draggable_region_ = std::move(region);
}

void LinuxWindow::CloseContents(content::WebContents* source) {
  if (source == shell_.get() && role_ == Role::kApp) {
    CloseRequestedByUser();
  }
}

bool LinuxWindow::IsWebContentsCreationOverridden(
    content::RenderFrameHost* opener,
    content::SiteInstance* source_site_instance,
    content::mojom::WindowContainerType window_container_type,
    const GURL& opener_url,
    const std::string& frame_name,
    const GURL& target_url) {
  return true;
}

bool LinuxWindow::IsInDraggableRegion(const gfx::Point& point) const {
  if (role_ != Role::kApp || !shell_view_) {
    return false;
  }
  gfx::Point local = point;
  views::View::ConvertPointToTarget(widget_->GetRootView(), shell_view_.get(),
                                    &local);
  return draggable_region_.contains(local.x(), local.y());
}

bool LinuxWindow::HitsNativeView(const gfx::Point& point) const {
  for (const auto& [view_id, slot] : native_views_) {
    if (!slot->container || !slot->container->GetVisible()) {
      continue;
    }
    gfx::Point local = point;
    views::View::ConvertPointToTarget(widget_->GetRootView(),
                                      slot->container.get(), &local);
    gfx::Rect visible = slot->container->GetLocalBounds();
    if (slot->clip) {
      visible.Intersect(*slot->clip - slot->frame.OffsetFromOrigin());
    }
    if (visible.Contains(local)) {
      return true;
    }
  }
  return false;
}

void LinuxWindow::AddNativeView(int view_id, views::View* view) {
  if (!view || !contents_view_ || widget_close_allowed_) {
    return;
  }
  RemoveNativeView(view_id);
  auto slot = std::make_unique<NativeViewSlot>();
  auto container = std::make_unique<views::View>();
  container->SetVisible(false);
  slot->container = contents_view_->AddChildView(std::move(container));
  slot->view = slot->container->AddChildViewRaw(view);
  native_views_[view_id] = std::move(slot);
}

void LinuxWindow::RemoveNativeView(int view_id) {
  auto it = native_views_.find(view_id);
  if (it == native_views_.end()) {
    return;
  }
  std::unique_ptr<NativeViewSlot> slot = std::move(it->second);
  native_views_.erase(it);
  if (slot->container && contents_view_) {
    if (slot->view) {
      slot->container->RemoveChildView(slot->view);
    }
    contents_view_->RemoveChildViewT(slot->container.get());
  }
}

void LinuxWindow::PlaceNativeView(
    int view_id,
    const std::optional<gfx::Rect>& frame,
    const std::optional<std::optional<gfx::Rect>>& clip,
    std::optional<bool> visible,
    std::optional<double> order) {
  auto it = native_views_.find(view_id);
  if (it == native_views_.end()) {
    return;
  }
  NativeViewSlot* slot = it->second.get();
  if (!slot->container || !slot->view) {
    return;
  }
  bool reorder = false;
  if (frame) {
    slot->frame = *frame;
  }
  if (clip) {
    slot->clip = *clip;
  }
  if (visible) {
    slot->visible = *visible;
  }
  if (order && *order != slot->order) {
    slot->order = *order;
    reorder = true;
  }
  slot->container->SetBoundsRect(slot->frame);
  slot->view->SetBoundsRect(gfx::Rect(slot->frame.size()));
  gfx::Rect local_clip;
  bool shown = slot->visible && !slot->frame.IsEmpty();
  if (slot->clip) {
    local_clip = *slot->clip - slot->frame.OffsetFromOrigin();
    local_clip.Intersect(gfx::Rect(slot->frame.size()));
    shown = shown && !local_clip.IsEmpty();
    if (local_clip == gfx::Rect(slot->frame.size())) {
      local_clip = gfx::Rect();
    }
  }
  views::WebView* web_view = views::AsViewClass<views::WebView>(slot->view.get());
  if (!web_view) {
    for (views::View* child : slot->view->children()) {
      if ((web_view = views::AsViewClass<views::WebView>(child))) {
        break;
      }
    }
  }
  if (web_view && web_view->holder()) {
    web_view->holder()->SetNativeViewClipRect(local_clip);
  }
  slot->container->SetVisible(shown);
  if (reorder) {
    std::vector<std::pair<double, int>> ordered;
    for (const auto& [id, s] : native_views_) {
      ordered.emplace_back(s->order, id);
    }
    std::ranges::sort(ordered);
    size_t index = (shell_view_ ? 1 : 0) + (host_page_view_ ? 1 : 0);
    for (const auto& [o, id] : ordered) {
      if (views::View* container = native_views_[id]->container.get()) {
        contents_view_->ReorderChildView(container, index++);
      }
    }
    if (widget_) {
      widget_->ReorderNativeViews();
    }
  }
}

void LinuxWindow::OnWidgetActivationChanged(views::Widget* widget, bool active) {
  if (active) {
    NoteActivated(this);
    if (!internal_ && role_ == Role::kApp) {
      LastUsersWindow() = GetWeakPtr();
    }
  }
  WindowObservers().Notify(&Observer::OnWindowActivationChanged, this, active);
  Browser* browser = !internal_ && active_profile_
                         ? ExistingBrowserFor(active_profile_)
                         : nullptr;
  if (!browser) {
    return;
  }
  if (active) {
    ActivateExclusively(browser);
  } else {
    BrowserActiveStateManager::From(browser)->DidBecomeInactive();
  }
}

void LinuxWindow::OnWidgetBoundsChanged(views::Widget* widget,
                                        const gfx::Rect& new_bounds) {
  ScheduleDialogPositionUpdate();
  for (Browser* browser : browsers()) {
    if (LinuxBrowserWindow* window = LinuxBrowserWindow::FromWindow(
            BrowserWindow::FromBrowser(browser))) {
      window->RepositionExclusiveAccessBubble();
    }
  }
  WindowObservers().Notify(&Observer::OnWindowBoundsChanged, this, new_bounds);
}

void LinuxWindow::OnWidgetShowStateChanged(views::Widget* widget) {
  if (!IsFullscreen()) {
    fullscreen_for_tab_ = false;
  }
  WindowObservers().Notify(&Observer::OnWindowStateChanged, this);
}

void LinuxWindow::OnWidgetDestroying(views::Widget* widget) {
  const bool unexpected = !widget_close_allowed_;
  if (unexpected) {
    WindowObservers().Notify(&Observer::OnWindowClosing, this);
  }
  for (auto& [view_id, slot] : native_views_) {
    if (slot->view && slot->container) {
      slot->container->RemoveChildView(slot->view);
    }
    slot->view = nullptr;
    slot->container = nullptr;
  }
  if (shell_view_) {
    shell_view_->SetWebContents(nullptr);
  }
  if (host_page_view_) {
    host_page_view_->SetWebContents(nullptr);
  }
  shell_view_ = nullptr;
  host_page_view_ = nullptr;
  contents_view_ = nullptr;
  if (!unexpected) {
    return;
  }
  widget_close_allowed_ = true;
  close_state_ = CloseState::kClosing;
  if (!chrome_token_.empty()) {
    ChromeMadeWindows().erase(chrome_token_);
  }
  for (Browser* browser : browsers()) {
    browser->GetWindow()->Close();
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&LinuxWindow::CloseWidget, GetWeakPtr()));
}

gfx::NativeView LinuxWindow::GetHostView() const {
  return native_view();
}

namespace {

gfx::Rect PageRect(const LinuxWindow* window) {
  Browser* browser = window->active_profile()
                         ? window->ExistingBrowserFor(window->active_profile())
                         : nullptr;
  content::WebContents* active =
      browser ? browser->GetTabStripModel()->GetActiveWebContents() : nullptr;
  LinuxTab* tab = LinuxTab::ForContents(active);
  views::View* view = tab ? tab->GetView() : nullptr;
  if (view && view->GetWidget() == window->widget() && view->IsDrawn()) {
    gfx::Rect bounds = view->GetLocalBounds();
    views::View::ConvertRectToTarget(view, window->widget()->GetRootView(),
                                     &bounds);
    return bounds;
  }
  return window->contents_view() ? window->contents_view()->bounds()
                                 : gfx::Rect();
}

}

gfx::Point LinuxWindow::GetDialogPosition(const gfx::Size& size) {
  const gfx::Rect page = PageRect(this);
  return gfx::Point(page.x() + std::max(0, (page.width() - size.width()) / 2),
                    page.y());
}

bool LinuxWindow::ShouldActivateDialog() const {
  BrowserWindowInterface* last =
      GetLastActiveBrowserWindowInterfaceWithAnyProfile();
  return last && ForBrowser(last) == this &&
         IsActiveBrowser(static_cast<Browser*>(last)) && IsActive() &&
         !Background();
}

gfx::Size LinuxWindow::GetMaximumDialogSize() {
  return PageRect(this).size();
}

void LinuxWindow::AddObserver(web_modal::ModalDialogHostObserver* observer) {
  if (!modal_observers_.HasObserver(observer)) {
    modal_observers_.AddObserver(observer);
  }
}

void LinuxWindow::RemoveObserver(web_modal::ModalDialogHostObserver* observer) {
  modal_observers_.RemoveObserver(observer);
}

void LinuxWindow::NotifyPositionRequiresUpdate() {
  dialog_position_update_scheduled_ = false;
  modal_observers_.Notify(
      &web_modal::ModalDialogHostObserver::OnPositionRequiresUpdate);
}

void LinuxWindow::ScheduleDialogPositionUpdate() {
  if (dialog_position_update_scheduled_) {
    return;
  }
  dialog_position_update_scheduled_ = true;
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&LinuxWindow::NotifyPositionRequiresUpdate,
                                GetWeakPtr()));
}

}
