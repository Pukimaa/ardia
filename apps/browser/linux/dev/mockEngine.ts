import type { ArdiaNative, ViewUpdate } from "../runtime/bridge";
import { moduleSpec } from "../runtime/moduleSpec.generated";
import { addModuleListener, documents, emit, emitted, emitView, MockError, options, sleep, viewListeners, type MockCall } from "./mock/core";
import { downloads, startDownload } from "./mock/downloads";
import { configurePager, forgetPagers } from "./mock/pagers";
import { commandLog, sendCommand } from "./mock/keys";
import { dismissPermission, pendingPermissions } from "./mock/permissions";
import { constants, handlers, linuxOnlyHandlers, mockState } from "./mock/services";
import { navigate, webViewState, webViews, createWebView, updateWebView, destroyWebView } from "./mock/webViews";
import { views } from "./mock/views";
import { focusedWindowId, openWindowIds, setSystemDark, windows } from "./mock/windows";

declare global {
  interface Window {
    __ardiaMock?: typeof mock;
  }
}

const calls: MockCall[] = [];
const callLimit = options.callLog ?? 4000;
let nextViewId = 1;

const record = (module: string, method: string, args: unknown[], sync: boolean) => {
  calls.push({ module, method, args, sync, at: Date.now() });
  if (calls.length > callLimit) calls.splice(0, calls.length - callLimit);
};

const handlerFor = (module: string, method: string) => {
  const handler = handlers[module]?.[method] ?? linuxOnlyHandlers[module]?.[method];
  if (!handler) throw new MockError("ERR_MOCK_UNIMPLEMENTED", `The mock engine has no ${module}.${method}`);
  return handler;
};

const reply = (value: unknown): unknown => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

const missing = (): string[] => {
  const out: string[] = [];
  for (const [module, spec] of Object.entries(moduleSpec)) {
    for (const method of Object.keys(spec.methods)) if (!handlers[module]?.[method]) out.push(`${module}.${method}`);
    for (const method of spec.view?.methods ?? []) if (!handlers[`${module}.view`]?.[method]) out.push(`${module}.view.${method}`);
  }
  return out;
};

const unknownHandlers = (): string[] => {
  const out: string[] = [];
  for (const [module, table] of Object.entries(handlers)) {
    if (module.endsWith(".view")) continue;
    for (const method of Object.keys(table)) if (!moduleSpec[module]?.methods[method]) out.push(`${module}.${method}`);
  }
  return out;
};

const ardiaNative: ArdiaNative = {
  constants: () => constants,
  callSync(module, method, args) {
    record(module, method, args, true);
    if (moduleSpec[module]?.methods[method] === "async") console.warn(`[mock] ${module}.${method} is an AsyncFunction but was called synchronously`);
    const value = handlerFor(module, method)(...args);
    if (value instanceof Promise) throw new MockError("ERR_MOCK_ASYNC", `${module}.${method} is asynchronous in the mock engine`);
    return reply(value);
  },
  async call(module, method, args) {
    record(module, method, args, false);
    if (options.latencyMs) await sleep(options.latencyMs);
    else await Promise.resolve();
    if (module === "ArdiaViews") return reply(viewsCall(method, args));
    return reply(await handlerFor(module, method)(...args));
  },
  addListener: addModuleListener,
  createView(manager, props, listener) {
    const viewId = nextViewId++;
    viewListeners.set(viewId, listener);
    record("ArdiaViews", "create", [manager, viewId, props], true);
    views.set(viewId, { manager, props: { ...props }, update: {}, windowId: typeof props.windowId === "string" ? props.windowId : null });
    if (manager === "ArdiaCEF") createWebView(viewId, props);
    if (manager === "ArdiaSwipe") configurePager(viewId, props.nativePager);
    return viewId;
  },
  updateView(viewId, update) {
    const view = views.get(viewId);
    if (!view) return;
    view.update = { ...view.update, ...update, ...(update.props ? { props: { ...view.update.props, ...update.props } } : {}) };
    if (update.props) view.props = { ...view.props, ...update.props };
    if (view.manager === "ArdiaCEF") updateWebView(viewId, update);
    if (view.manager === "ArdiaSwipe" && update.props && "nativePager" in update.props) configurePager(viewId, update.props.nativePager);
  },
  destroyView(viewId) {
    const view = views.get(viewId);
    viewListeners.delete(viewId);
    views.delete(viewId);
    if (view?.manager === "ArdiaCEF") destroyWebView(viewId);
    if (view?.manager === "ArdiaSwipe") forgetPagers(viewId);
  },
  async callView(manager, viewId, method, args) {
    record(`${manager}.view`, method, [viewId, ...args], false);
    await Promise.resolve();
    if (!views.has(viewId)) throw Object.assign(new Error(`Unable to find the '${manager}' view with tag ${viewId}`), { code: "ERR_ARGUMENT_CAST" });
    return reply(await handlerFor(`${manager}.view`, method)(viewId, ...args));
  },
};

const viewsCall = (method: string, args: unknown[]) => {
  const [viewId, update] = args as [number, ViewUpdate];
  if (method === "update") ardiaNative.updateView(viewId, update);
  if (method === "destroy") ardiaNative.destroyView(viewId);
  return null;
};

const mock = {
  options,
  calls,
  emitted,
  documents,
  commandLog,
  emit,
  emitView,
  missing,
  unknownHandlers,
  state: mockState,
  windows: () =>
    [...windows.values()].map((entry) => ({ id: entry.id, title: entry.title, open: !!entry.win && !entry.win.closed, blocked: entry.blocked, kind: entry.options.kind ?? "browser", incognito: !!entry.options.incognito })),
  openWindowIds,
  focusedWindowId,
  command: (command: string, arg: string | null = null, windowId: string | null = null) => sendCommand(command, arg, windowId ?? focusedWindowId()),
  views: () => [...views.entries()].map(([viewId, view]) => ({ viewId, manager: view.manager, windowId: view.windowId, props: view.props, update: view.update })),
  webViews: () => [...webViews.keys()].map((viewId) => webViewState(viewId)),
  navigate: (viewId: number, url: string) => {
    const view = webViews.get(viewId);
    if (view) navigate(view, url);
  },
  setSystemDark,
  downloads: () => [...downloads.values()].map((download) => ({ ...download })),
  startDownload,
  permissions: pendingPermissions,
  dismissPermission,
  callsTo: (module: string, method?: string) => calls.filter((call) => call.module === module && (!method || call.method === method)),
};

window.ardiaNative = ardiaNative;
window.__ardiaMock = mock;
