// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_LINUX_AC_LINUX_HOST_H_
#define ARDIA_CORE_LINUX_AC_LINUX_HOST_H_

#include <string>
#include <string_view>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "url/gurl.h"

class Profile;

namespace content {
class RenderFrameHost;
class WebContents;
}

namespace ardia::linux_host {

class LinuxWindow;

struct LaunchSettings {
  base::FilePath app_data_dir;
  base::FilePath chromium_data_dir;
  bool scratch_data_dir = false;
  bool background = false;
  bool test_key_store = false;
  std::vector<std::string> launch_urls;
};

const LaunchSettings& Launch();
void SetLaunchSettings(const LaunchSettings& settings);
bool Background();
std::vector<std::string> TakeLaunchURLs();

void PrepareBrowserProcess();
void StartHost();
void ShutDownHost();
bool HostStarted();

content::WebContents* HostPage();
Profile* HostProfile();
bool IsHostPage(const content::WebContents* contents);
bool IsShellContents(const content::WebContents* contents);
bool IsShellFrame(content::RenderFrameHost* frame);
bool IsPendingShellDocument(const content::WebContents* contents);
void OpenWindowDocument(LinuxWindow* window);
void WhenHostReady(base::OnceClosure ready);

GURL ShellURL(std::string_view path);
std::string WindowDocumentFrameName(std::string_view window_id);

}

#endif
