// Copyright 2026 Ardia. Apache-2.0.

#include <algorithm>
#include <cmath>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "ardia/core/linux/ac_linux_bridge.h"
#include "ardia/core/linux/ac_linux_tab.h"
#include "ardia/core/linux/ac_linux_window.h"
#include "base/no_destructor.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/values.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/views/view.h"

namespace ardia::linux_host {

namespace {

constexpr char kViewsModule[] = "ArdiaViews";
constexpr char kViewSuffix[] = ".view";
constexpr char kWindowIdKey[] = "windowId";

struct ViewRecord {
  std::string manager;
  std::unique_ptr<LinuxNativeView> view;
  base::WeakPtr<LinuxWindow> window;
  raw_ptr<content::WebContents> shell = nullptr;
  raw_ptr<views::View> hosted = nullptr;
  std::optional<gfx::Rect> frame;
  std::optional<std::optional<gfx::Rect>> clip;
  std::optional<bool> visible;
  std::optional<double> order;
};

std::map<std::string, NativeViewFactory, std::less<>>& Factories() {
  static base::NoDestructor<std::map<std::string, NativeViewFactory, std::less<>>>
      factories;
  return *factories;
}

std::map<int, ViewRecord>& Records() {
  static base::NoDestructor<std::map<int, ViewRecord>> records;
  return *records;
}

std::optional<gfx::Rect> RectFrom(const base::Value* value) {
  if (!value || !value->is_dict()) {
    return std::nullopt;
  }
  const base::DictValue& dict = value->GetDict();
  const std::optional<double> x = dict.FindDouble("x");
  const std::optional<double> y = dict.FindDouble("y");
  const std::optional<double> width = dict.FindDouble("width");
  const std::optional<double> height = dict.FindDouble("height");
  if (!x || !y || !width || !height) {
    return std::nullopt;
  }
  const int left = static_cast<int>(std::lround(*x));
  const int top = static_cast<int>(std::lround(*y));
  const int right = static_cast<int>(std::lround(*x + std::max(0.0, *width)));
  const int bottom = static_cast<int>(std::lround(*y + std::max(0.0, *height)));
  return gfx::Rect(left, top, right - left, bottom - top);
}

LinuxWindow* WindowFor(const std::string* window_id,
                       content::WebContents* shell) {
  if (window_id && !window_id->empty()) {
    if (LinuxWindow* window = LinuxWindow::ForId(*window_id)) {
      return window;
    }
  }
  if (LinuxWindow* window = LinuxWindow::ForShell(shell)) {
    return window;
  }
  LinuxWindow* only = nullptr;
  int count = 0;
  for (LinuxWindow* window : LinuxWindow::All()) {
    if (window->role() == LinuxWindow::Role::kApp && !window->closing()) {
      only = window;
      ++count;
    }
  }
  return count == 1 ? only : LinuxWindow::LastActive();
}

void SyncHosting(int view_id, ViewRecord& record) {
  LinuxWindow* window = record.window.get();
  views::View* wanted = window && record.view ? record.view->GetView() : nullptr;
  if (wanted == record.hosted.get()) {
    return;
  }
  if (record.hosted && window) {
    window->RemoveNativeView(view_id);
  }
  record.hosted = wanted;
  if (wanted) {
    window->AddNativeView(view_id, wanted);
    window->PlaceNativeView(view_id, record.frame, record.clip,
                            record.visible, record.order);
  }
}

void Attach(int view_id, ViewRecord& record, LinuxWindow* window) {
  if (record.window.get() == window) {
    SyncHosting(view_id, record);
    return;
  }
  if (LinuxWindow* old = record.window.get(); old && record.hosted) {
    old->RemoveNativeView(view_id);
  }
  record.hosted = nullptr;
  record.window = window ? window->GetWeakPtr() : nullptr;
  if (record.view) {
    record.view->AttachedToWindow(window);
  }
  SyncHosting(view_id, record);
}

class WindowWatcher : public LinuxWindow::Observer {
 public:
  WindowWatcher() { LinuxWindow::AddObserver(this); }
  ~WindowWatcher() override { LinuxWindow::RemoveObserver(this); }

  void OnWindowClosing(LinuxWindow* window) override {
    for (auto& [view_id, record] : Records()) {
      if (record.window.get() == window) {
        Attach(view_id, record, nullptr);
      }
    }
  }
};

void EnsureWindowWatcher() {
  static base::NoDestructor<WindowWatcher> watcher;
}

class ViewsModule : public LinuxNativeModule {
 public:
  ViewsModule() { EnsureWindowWatcher(); }

  std::string_view name() const override { return kViewsModule; }

  void Call(const CallContext& context,
            std::string_view method,
            base::ListValue args,
            CallReply reply) override {
    if (method == "create") {
      Create(context, std::move(args), std::move(reply));
    } else if (method == "update") {
      Update(context, std::move(args), std::move(reply));
    } else if (method == "destroy") {
      Destroy(std::move(args), std::move(reply));
    } else {
      reply.Error("ERR_METHOD_NOT_FOUND",
                  base::StrCat({kViewsModule, " has no method ", method}));
    }
  }

 private:
  void Create(const CallContext& context,
              base::ListValue args,
              CallReply reply) {
    if (args.size() < 2 || !args[0].is_string() || !args[1].is_int()) {
      reply.Error("ERR_INVALID_ARGUMENTS",
                  "ArdiaViews.create(manager, viewId, props)");
      return;
    }
    const std::string manager = args[0].GetString();
    const int view_id = args[1].GetInt();
    base::DictValue props;
    if (args.size() > 2 && args[2].is_dict()) {
      props = std::move(args[2]).TakeDict();
    }
    std::optional<std::string> window_id;
    if (const std::string* id = props.FindString(kWindowIdKey)) {
      window_id = *id;
    }
    props.Remove(kWindowIdKey);

    if (Records().contains(view_id)) {
      DestroyRecord(view_id);
    }
    LinuxWindow* window =
        WindowFor(window_id ? &*window_id : nullptr, context.shell);
    ViewRecord& record = Records()[view_id];
    record.manager = manager;
    record.shell = context.shell;

    NativeViewParams params;
    params.window = window;
    params.shell = context.shell;
    params.view_id = view_id;
    params.manager = manager;
    if (manager == "ArdiaCEF") {
      record.view = CreateTabView(params);
    } else if (auto it = Factories().find(manager); it != Factories().end()) {
      record.view = it->second.Run(params);
    }
    if (record.view) {
      record.view->SetProps(props);
      Attach(view_id, record, window);
      record.view->PropsDidUpdate();
      SyncHosting(view_id, record);
    }
    reply.Ok();
  }

  void Update(const CallContext& context,
              base::ListValue args,
              CallReply reply) {
    if (args.size() < 2 || !args[0].is_int() || !args[1].is_dict()) {
      reply.Error("ERR_INVALID_ARGUMENTS", "ArdiaViews.update(viewId, update)");
      return;
    }
    const int view_id = args[0].GetInt();
    auto it = Records().find(view_id);
    if (it == Records().end()) {
      reply.Ok();
      return;
    }
    ViewRecord& record = it->second;
    base::DictValue update = std::move(args[1]).TakeDict();

    if (const std::string* window_id = update.FindString(kWindowIdKey)) {
      if (LinuxWindow* window = LinuxWindow::ForId(*window_id)) {
        Attach(view_id, record, window);
      }
    } else if (!record.window) {
      Attach(view_id, record, WindowFor(nullptr, context.shell));
    }

    if (base::DictValue* props = update.FindDict("props");
        props && record.view) {
      props->Remove(kWindowIdKey);
      record.view->SetProps(*props);
      record.view->PropsDidUpdate();
    }
    SyncHosting(view_id, record);

    std::optional<gfx::Rect> frame = RectFrom(update.Find("frame"));
    std::optional<std::optional<gfx::Rect>> clip;
    if (const base::Value* value = update.Find("clip")) {
      clip = value->is_none() ? std::optional<gfx::Rect>() : RectFrom(value);
    }
    std::optional<bool> visible = update.FindBool("visible");
    std::optional<double> order = update.FindDouble("order");
    if (frame) {
      record.frame = frame;
    }
    if (clip) {
      record.clip = clip;
    }
    if (visible) {
      record.visible = visible;
    }
    if (order) {
      record.order = order;
    }
    if (LinuxWindow* window = record.window.get(); window && record.hosted) {
      window->PlaceNativeView(view_id, frame, clip, visible, order);
    }
    if (frame && record.view) {
      record.view->FrameChanged(*frame);
    }
    reply.Ok();
  }

  void Destroy(base::ListValue args, CallReply reply) {
    if (args.empty() || !args[0].is_int()) {
      reply.Error("ERR_INVALID_ARGUMENTS", "ArdiaViews.destroy(viewId)");
      return;
    }
    DestroyRecord(args[0].GetInt());
    reply.Ok();
  }

  static void DestroyRecord(int view_id) {
    auto it = Records().find(view_id);
    if (it == Records().end()) {
      return;
    }
    ViewRecord record = std::move(it->second);
    Records().erase(it);
    if (LinuxWindow* window = record.window.get(); window && record.hosted) {
      window->RemoveNativeView(view_id);
    }
    record.hosted = nullptr;
    record.view.reset();
  }
};

class ViewMethodsModule : public LinuxNativeModule {
 public:
  explicit ViewMethodsModule(std::string manager)
      : manager_(std::move(manager)),
        name_(base::StrCat({manager_, kViewSuffix})) {}

  std::string_view name() const override { return name_; }

  void Call(const CallContext& context,
            std::string_view method,
            base::ListValue args,
            CallReply reply) override {
    if (args.empty() || !args[0].is_int()) {
      reply.Error("ERR_INVALID_ARGUMENTS",
                  base::StrCat({name_, ".", method, "(viewId, ...)"}));
      return;
    }
    const int view_id = args[0].GetInt();
    auto it = Records().find(view_id);
    if (it == Records().end() || !it->second.view ||
        it->second.manager != manager_) {
      reply.Error("ERR_VIEW_NOT_FOUND",
                  base::StrCat({name_, ": no view ", base::NumberToString(view_id)}));
      return;
    }
    base::ListValue rest;
    for (size_t i = 1; i < args.size(); ++i) {
      rest.Append(std::move(args[i]));
    }
    it->second.view->Call(context, method, std::move(rest), std::move(reply));
  }

 private:
  const std::string manager_;
  const std::string name_;
};

}

LinuxNativeView::~LinuxNativeView() = default;

void LinuxNativeView::PropsDidUpdate() {}

void LinuxNativeView::FrameChanged(const gfx::Rect& frame) {}

void LinuxNativeView::AttachedToWindow(LinuxWindow* window) {}

void LinuxNativeView::Call(const CallContext& context,
                           std::string_view method,
                           base::ListValue args,
                           CallReply reply) {
  reply.Error("ERR_METHOD_NOT_FOUND",
              base::StrCat({"this native view has no method ", method}));
}

void RegisterNativeViewFactory(std::string_view manager,
                               NativeViewFactory factory) {
  Factories()[std::string(manager)] = std::move(factory);
}

LinuxNativeView* FindNativeView(int view_id) {
  auto it = Records().find(view_id);
  return it == Records().end() ? nullptr : it->second.view.get();
}

int FindNativeViewId(const LinuxNativeView* view) {
  for (const auto& [view_id, record] : Records()) {
    if (record.view.get() == view) {
      return view_id;
    }
  }
  return 0;
}

std::unique_ptr<LinuxNativeModule> MakeViewsModule() {
  return std::make_unique<ViewsModule>();
}

std::unique_ptr<LinuxNativeModule> MakeViewMethodsModule(std::string manager) {
  return std::make_unique<ViewMethodsModule>(std::move(manager));
}

}
