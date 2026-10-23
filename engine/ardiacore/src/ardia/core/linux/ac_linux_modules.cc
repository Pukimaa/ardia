// Copyright 2026 Ardia. Apache-2.0.

#include <memory>
#include <string>
#include <string_view>

#include "ardia/core/linux/ac_linux_bridge.h"
#include "base/logging.h"
#include "base/strings/strcat.h"
#include "base/values.h"

namespace ardia::linux_host {

std::unique_ptr<LinuxNativeModule> MakeViewsModule();
std::unique_ptr<LinuxNativeModule> MakeViewMethodsModule(std::string manager);

std::unique_ptr<LinuxNativeModule> MakeCefModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeExtensionsModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeChromeUIModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeSwipeModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeShellModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeAppModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeSystemModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeImportModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeSyncModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeCliModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeUserScriptsModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeTranslateModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeInlineCompletionModule()
    __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeAreaLightModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeKeychainModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeCalendarModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeGlassEffectModule() __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeDockSelectionModule()
    __attribute__((weak));
std::unique_ptr<LinuxNativeModule> MakeFileDropModule() __attribute__((weak));

namespace {

using ModuleFactory = std::unique_ptr<LinuxNativeModule> (*)();

class GlassEffectModule : public LinuxNativeModule {
 public:
  std::string_view name() const override { return "ArdiaGlassEffect"; }
  void Call(const CallContext& context,
            std::string_view method,
            base::ListValue args,
            CallReply reply) override {
    if (method == "isLiquidGlass") {
      reply.Ok(base::Value(false));
      return;
    }
    reply.Error("ERR_METHOD_NOT_FOUND",
                base::StrCat({"ArdiaGlassEffect has no method ", method}));
  }
};

class DockSelectionModule : public LinuxNativeModule {
 public:
  std::string_view name() const override { return "ArdiaDockSelection"; }
  void Call(const CallContext& context,
            std::string_view method,
            base::ListValue args,
            CallReply reply) override {
    if (method == "iconTheme") {
      reply.Ok();
      return;
    }
    reply.Error("ERR_METHOD_NOT_FOUND",
                base::StrCat({"ArdiaDockSelection has no method ", method}));
  }
};

class FileDropModule : public LinuxNativeModule {
 public:
  std::string_view name() const override { return "ArdiaFileDrop"; }
  void Call(const CallContext& context,
            std::string_view method,
            base::ListValue args,
            CallReply reply) override {
    if (method == "devDrag") {
      reply.Ok(base::Value("debug builds only"));
      return;
    }
    if (method == "devLastFileDrag") {
      reply.Ok(base::Value(base::ListValue()));
      return;
    }
    reply.Error("ERR_METHOD_NOT_FOUND",
                base::StrCat({"ArdiaFileDrop has no method ", method}));
  }
};

std::unique_ptr<LinuxNativeModule> MakeLinuxGlassEffect() {
  return std::make_unique<GlassEffectModule>();
}

std::unique_ptr<LinuxNativeModule> MakeLinuxDockSelection() {
  return std::make_unique<DockSelectionModule>();
}

std::unique_ptr<LinuxNativeModule> MakeLinuxFileDrop() {
  return std::make_unique<FileDropModule>();
}

struct ModuleEntry {
  const char* name;
  ModuleFactory factory;
  ModuleFactory fallback;
};

void RegisterModule(Bridge& bridge, const ModuleEntry& entry) {
  ModuleFactory factory = entry.factory ? entry.factory : entry.fallback;
  if (!factory) {
    LOG(ERROR) << "[ardiacore] the engine has no " << entry.name << " module";
    return;
  }
  std::unique_ptr<LinuxNativeModule> module = factory();
  if (!module) {
    LOG(ERROR) << "[ardiacore] the " << entry.name << " module did not start";
    return;
  }
  if (module->name() != entry.name) {
    LOG(ERROR) << "[ardiacore] the " << entry.name << " module calls itself "
               << module->name();
  }
  bridge.Register(std::move(module));
}

}

void RegisterAllModules(Bridge& bridge) {
  static bool registered = false;
  if (registered) {
    return;
  }
  registered = true;

  bridge.Register(MakeViewsModule());
  bridge.Register(MakeViewMethodsModule("ArdiaCEF"));
  bridge.Register(MakeViewMethodsModule("ArdiaSwipe"));

  const ModuleEntry entries[] = {
      {"ArdiaCEF", &MakeCefModule, nullptr},
      {"ArdiaExtensions", &MakeExtensionsModule, nullptr},
      {"ArdiaChromeUI", &MakeChromeUIModule, nullptr},
      {"ArdiaSwipe", &MakeSwipeModule, nullptr},
      {"ArdiaShell", &MakeShellModule, nullptr},
      {"ArdiaApp", &MakeAppModule, nullptr},
      {"ArdiaSystem", &MakeSystemModule, nullptr},
      {"ArdiaImport", &MakeImportModule, nullptr},
      {"ArdiaSync", &MakeSyncModule, nullptr},
      {"ArdiaCli", &MakeCliModule, nullptr},
      {"ArdiaUserScripts", &MakeUserScriptsModule, nullptr},
      {"ArdiaTranslate", &MakeTranslateModule, nullptr},
      {"ArdiaInlineCompletion", &MakeInlineCompletionModule, nullptr},
      {"ArdiaAreaLight", &MakeAreaLightModule, nullptr},
      {"ArdiaKeychain", &MakeKeychainModule, nullptr},
      {"ArdiaCalendar", &MakeCalendarModule, nullptr},
      {"ArdiaGlassEffect", &MakeGlassEffectModule, &MakeLinuxGlassEffect},
      {"ArdiaDockSelection", &MakeDockSelectionModule, &MakeLinuxDockSelection},
      {"ArdiaFileDrop", &MakeFileDropModule, &MakeLinuxFileDrop},
  };
  for (const ModuleEntry& entry : entries) {
    RegisterModule(bridge, entry);
  }
}

}
