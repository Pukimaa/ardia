// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_LINUX_AC_LINUX_TAB_H_
#define ARDIA_CORE_LINUX_AC_LINUX_TAB_H_

#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "ardia/core/linux/ac_linux_window.h"
#include "base/functional/callback.h"
#include "base/values.h"

class GURL;
class Profile;

namespace content {
class RenderWidgetHost;
class WebContents;
}

namespace ardia::linux_host {

class LinuxTab : public LinuxNativeView {
 public:
  static LinuxTab* ForContents(const content::WebContents* contents);
  static std::string OfferTab(content::WebContents* contents,
                              std::string_view prefix);

  virtual content::WebContents* contents() const = 0;
  virtual const std::string& profile_name() const = 0;
  virtual const std::string& transfer_key() const = 0;
  virtual bool visible() const = 0;
  virtual void Emit(std::string_view event, base::DictValue payload) = 0;
  virtual void OpenedTab(content::WebContents* tab,
                         const std::string& adopt_id,
                         std::string_view disposition) = 0;
  virtual void TabRemovedFromWindow(LinuxWindow* window) = 0;
  virtual void TabActivatedByChrome(bool by_chrome) = 0;
  virtual void DevToolsChanged(content::WebContents* devtools) = 0;
  virtual void RequestFocusRestore() = 0;
};

std::unique_ptr<LinuxNativeView> CreateTabView(const NativeViewParams& params);

void WithProfile(const std::string& name,
                 base::OnceCallback<void(Profile*)> done);
std::string ProfileName(Profile* profile);
std::vector<Profile*> LoadedProfiles();
bool IsOffTheRecordOf(Profile* profile, const std::string& name);
bool IsProfileGoing(const Profile* profile);

void TabStatusTextChanged(content::WebContents* contents, const GURL& url);
bool TabRequestsActivation(content::WebContents* contents,
                           std::string_view reason);
void TabUnresponsive(content::WebContents* contents,
                     content::RenderWidgetHost* host,
                     base::RepeatingClosure hang_monitor_restarter);
void TabResponsive(content::WebContents* contents,
                   content::RenderWidgetHost* host);
void TabInsertedInWindow(content::WebContents* contents);
void TabWillClose(content::WebContents* contents);
void MarkTabMadeAhead(content::WebContents* contents);
bool TabOnlyShowedBlank(content::WebContents* contents);

}

#endif
