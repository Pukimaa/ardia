// Copyright 2026 Ardia. Apache-2.0.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <set>
#include <string>
#include <utility>
#include <vector>

#include "ardia/core/linux/ac_linux_host.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"

extern "C" {
int ChromeMain(int argc, const char** argv);
}

namespace ardia::linux_host {

namespace {

bool EnvSet(const char* name) {
  const char* value = getenv(name);
  return value && *value;
}

bool EnvIs(const char* name, const char* value) {
  const char* set = getenv(name);
  return set && !strcmp(set, value);
}

std::string CurrentDirectory() {
  std::vector<char> buffer(4096);
  if (!getcwd(buffer.data(), buffer.size())) {
    return std::string();
  }
  return std::string(buffer.data());
}

std::string Standardized(std::string path) {
  if (path.empty()) {
    return path;
  }
  if (path[0] != '/') {
    path = CurrentDirectory() + "/" + path;
  }
  std::vector<std::string> parts;
  size_t from = 0;
  while (from <= path.size()) {
    size_t slash = path.find('/', from);
    if (slash == std::string::npos) {
      slash = path.size();
    }
    std::string part = path.substr(from, slash - from);
    if (part == "..") {
      if (!parts.empty()) {
        parts.pop_back();
      }
    } else if (!part.empty() && part != ".") {
      parts.push_back(std::move(part));
    }
    from = slash + 1;
  }
  std::string standardized;
  for (const std::string& part : parts) {
    standardized += "/" + part;
  }
  return standardized.empty() ? "/" : standardized;
}

std::string InstalledAppDataDirectory() {
  std::string config;
  if (const char* xdg = getenv("XDG_CONFIG_HOME"); xdg && *xdg == '/') {
    config = xdg;
  } else if (const char* home = getenv("HOME"); home && *home) {
    config = std::string(home) + "/.config";
  } else {
    config = "/tmp";
  }
  return config + "/Ardia";
}

bool MakeDirectories(const std::string& path) {
  return base::CreateDirectoryAndGetError(base::FilePath(path), nullptr);
}

std::string FeatureEntryName(const std::string& entry) {
  const size_t start = !entry.empty() && entry[0] == '*' ? 1 : 0;
  const size_t end = entry.find_first_of("<:", start);
  return entry.substr(start,
                      end == std::string::npos ? std::string::npos : end - start);
}

std::vector<std::string> MergeFeatureLists(const std::vector<std::string>& args) {
  std::vector<std::string> switches;
  std::vector<std::string> positional;
  std::vector<std::pair<bool, std::string>> entries;
  bool terminated = false;
  for (size_t i = 1; i < args.size(); i++) {
    const std::string& arg = args[i];
    if (terminated || arg == "--") {
      terminated = true;
      positional.push_back(arg);
      continue;
    }
    const bool enable = arg.starts_with("--enable-features=");
    if (!enable && !arg.starts_with("--disable-features=")) {
      switches.push_back(arg);
      continue;
    }
    std::string list = arg.substr(enable ? 18 : 19);
    for (size_t from = 0; from <= list.size();) {
      size_t comma = list.find(',', from);
      if (comma == std::string::npos) {
        comma = list.size();
      }
      if (comma > from) {
        entries.emplace_back(enable, list.substr(from, comma - from));
      }
      from = comma + 1;
    }
  }
  std::set<std::string> decided;
  std::string enabled;
  std::string disabled;
  for (auto entry = entries.rbegin(); entry != entries.rend(); ++entry) {
    if (!decided.insert(FeatureEntryName(entry->second)).second) {
      continue;
    }
    std::string& list = entry->first ? enabled : disabled;
    list = list.empty() ? entry->second : entry->second + "," + list;
  }
  if (!enabled.empty()) {
    switches.push_back("--enable-features=" + enabled);
  }
  if (!disabled.empty()) {
    switches.push_back("--disable-features=" + disabled);
  }
  switches.insert(switches.end(), positional.begin(), positional.end());
  return switches;
}

bool AutoAccepts(const std::string& sw) {
  return EnvSet("ARDIA_BACKGROUND") &&
         (sw.starts_with("--use-fake-ui-for-media-stream") ||
          sw.starts_with("--auto-accept-camera-and-microphone-capture"));
}

std::vector<std::string> SplitSwitches(const std::string& all) {
  std::vector<std::string> switches;
  const std::string padded = " " + all;
  size_t from = 0;
  while (from < padded.size()) {
    size_t next = padded.find(" --", from + 1);
    if (next == std::string::npos) {
      next = padded.size();
    }
    std::string item = padded.substr(from, next - from);
    const size_t start = item.find_first_not_of(" ");
    const size_t end = item.find_last_not_of(" ");
    if (start != std::string::npos) {
      item = item.substr(start, end - start + 1);
      if (!item.starts_with("--")) {
        item = "--" + item;
      }
      if (item.size() > 2) {
        switches.push_back(item);
      }
    }
    from = next;
  }
  return switches;
}

bool IsChildProcess(int argc, const char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (argv[i] && !strncmp(argv[i], "--type=", 7)) {
      return true;
    }
  }
  return false;
}

int RunBrowser(int argc, const char** argv) {
  const char* data_dir = getenv("ARDIA_DATA_DIR");
  const bool scratch = data_dir && *data_dir;
#if !defined(NDEBUG)
  if (!scratch) {
    fprintf(stderr, "[ardiacore] set ARDIA_DATA_DIR to a scratch directory\n");
    return 1;
  }
#endif
  LaunchSettings settings;
  settings.scratch_data_dir = scratch;
  settings.background = EnvSet("ARDIA_BACKGROUND");
  settings.test_key_store = scratch;
  const std::string app_data =
      scratch ? Standardized(data_dir) : InstalledAppDataDirectory();
  const std::string chromium_data = app_data + "/Chromium";
  if (!MakeDirectories(chromium_data)) {
    fprintf(stderr, "[ardiacore] can't use the data dir %s\n",
            chromium_data.c_str());
    return 1;
  }
  settings.app_data_dir = base::FilePath(app_data);
  settings.chromium_data_dir = base::FilePath(chromium_data);

  const bool freeze_least_recent_tabs = !EnvIs("ARDIA_TAB_FREEZING", "off");
  const bool thaw_frozen_tabs_rarely = !EnvIs("ARDIA_SLOW_TAB_THAW", "off");
  const bool throttle_main_frames = !EnvIs("ARDIA_MAIN_FRAME_THROTTLE", "off");
  const bool full_rate_after_input = !EnvIs("ARDIA_SCROLL_FULL_RATE", "off");
  const bool biometrics_check_per_tab = EnvIs("ARDIA_WALLET_PASSES", "on");

  std::vector<std::string> extra = {
      "--user-data-dir=" + chromium_data,
      "--enable-smooth-scrolling",
      "--disable-stack-profiler",
      "--ozone-platform-hint=auto",
      std::string("--disable-features=DevToolsAcceptDebuggingConnections") +
          (biometrics_check_per_tab ? "" : ",AutofillAiWalletPrivatePasses") +
          (freeze_least_recent_tabs ? "" : ",InfiniteTabsFreezing"),
      std::string("--enable-features=WebContentsDiscard,"
                  "ImprovedStartupBestEffortDelay:StartupDelayStopOnLoadingTimedOut/true,"
                  "CPUMeasurementInFreezingPolicy:freezing_visible_protection_time/0s") +
          (freeze_least_recent_tabs
               ? (thaw_frozen_tabs_rarely
                      ? ",InfiniteTabsFreezing:ardia_unconnected_unfreeze_interval/600s"
                      : ",InfiniteTabsFreezing")
               : "") +
          (throttle_main_frames
               ? (full_rate_after_input
                      ? ",ThrottleMainFrameTo60Hz,UrgentMainFrameForInput"
                      : ",ThrottleMainFrameTo60Hz:ardia_full_rate_after_input/0s,"
                        "UrgentMainFrameForInput")
               : ""),
      "--profile-directory=Default",
      "--js-flags=--no-memory-reducer",
  };
  if (settings.test_key_store) {
    extra.push_back("--password-store=basic");
  }
  if (settings.background && !EnvSet("ARDIA_ALLOW_OCCLUSION")) {
    extra.push_back("--disable-backgrounding-occluded-windows");
  }
  if (settings.background && !EnvSet("ARDIA_ALLOW_AUDIO")) {
    extra.push_back("--mute-audio");
  }
  if (settings.background) {
    extra.push_back("--use-fake-device-for-media-stream");
    extra.push_back("--disable-modal-animations");
  }
  if (const char* port = getenv("ARDIA_REMOTE_DEBUGGING_PORT");
      port && *port && settings.test_key_store) {
    extra.push_back(std::string("--remote-debugging-port=") + port);
    extra.push_back("--remote-allow-origins=*");
  }
  if (const char* switches = getenv("ARDIA_CHROMIUM_SWITCHES");
      switches && settings.test_key_store) {
    for (const std::string& sw : SplitSwitches(switches)) {
      if (!AutoAccepts(sw)) {
        extra.push_back(sw);
      }
    }
  }

  std::vector<std::string> args = {argc > 0 && argv[0] ? argv[0] : "ardia"};
  args.insert(args.end(), extra.begin(), extra.end());
  for (int i = 1; i < argc; i++) {
    const char* arg = argv[i];
    if (!arg) {
      break;
    }
    const bool is_switch = arg[0] == '-';
    if (!is_switch) {
      settings.launch_urls.push_back(arg);
    }
    if (!settings.test_key_store || AutoAccepts(arg)) {
      continue;
    }
    if (is_switch) {
      args.push_back(arg);
    }
  }
  SetLaunchSettings(settings);

  static std::vector<std::string> merged;
  merged = MergeFeatureLists(args);
  merged.insert(merged.begin(), args[0]);
  static std::vector<const char*> pointers;
  pointers.clear();
  for (const std::string& arg : merged) {
    pointers.push_back(arg.c_str());
  }
  pointers.push_back(nullptr);

  PrepareBrowserProcess();
  return ChromeMain(static_cast<int>(merged.size()), pointers.data());
}

}

}

extern "C" int ArdiaLinuxMain(int argc, const char** argv) {
  if (ardia::linux_host::IsChildProcess(argc, argv)) {
    return ChromeMain(argc, argv);
  }
  return ardia::linux_host::RunBrowser(argc, argv);
}
