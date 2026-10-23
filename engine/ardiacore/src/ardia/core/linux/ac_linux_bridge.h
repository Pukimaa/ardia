// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_LINUX_AC_LINUX_BRIDGE_H_
#define ARDIA_CORE_LINUX_AC_LINUX_BRIDGE_H_

#include <map>
#include <memory>
#include <string>
#include <string_view>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"

namespace content {
class BrowserContext;
class WebContents;
}

namespace ardia::linux_host {

class LinuxWindow;

struct CallError {
  std::string code;
  std::string message;
};

class CallReply {
 public:
  using Sink = base::OnceCallback<void(std::string json)>;
  explicit CallReply(Sink sink);
  CallReply(CallReply&&);
  CallReply& operator=(CallReply&&);
  ~CallReply();

  void Ok(base::Value value);
  void Ok();
  void Error(std::string_view code, std::string_view message);

 private:
  Sink sink_;
};

struct CallContext {
  raw_ptr<LinuxWindow> window = nullptr;
  raw_ptr<content::WebContents> shell = nullptr;
  bool sync = false;
};

class LinuxNativeModule {
 public:
  virtual ~LinuxNativeModule() = default;
  virtual std::string_view name() const = 0;
  virtual base::DictValue Constants() const;
  virtual void Call(const CallContext& context,
                    std::string_view method,
                    base::ListValue args,
                    CallReply reply) = 0;
};

class Bridge {
 public:
  static Bridge& Get();

  void Register(std::unique_ptr<LinuxNativeModule> module);
  LinuxNativeModule* Find(std::string_view name) const;
  base::DictValue Constants() const;

  void Dispatch(const CallContext& context,
                std::string_view module,
                std::string_view method,
                std::string_view args_json,
                CallReply::Sink sink);

  void Emit(std::string_view module, std::string_view event, base::Value payload);
  void EmitTo(content::WebContents* shell,
              std::string_view module,
              std::string_view event,
              base::Value payload);
  void EmitView(content::WebContents* shell,
                int view_id,
                std::string_view event,
                base::Value payload);

 private:
  Bridge();
  ~Bridge();
  std::map<std::string, std::unique_ptr<LinuxNativeModule>, std::less<>> modules_;
};

void RegisterAllModules(Bridge& bridge);

}

#endif
