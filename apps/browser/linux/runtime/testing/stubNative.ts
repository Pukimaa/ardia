import type { ArdiaNative, ModuleListener, ViewListener, ViewUpdate } from "../bridge";

type StubCall = { module: string; method: string; args: unknown[]; sync: boolean };

type StubReply = unknown | ((...args: unknown[]) => unknown);

type StubState = {
  calls: StubCall[];
  replies: Record<string, StubReply>;
  constants: Record<string, Record<string, unknown>>;
  views: Map<number, { manager: string; props: Record<string, unknown>; update: ViewUpdate }>;
  documents: Map<string, string>;
  emit(module: string, event: string, payload: unknown): void;
  emitView(viewId: number, event: string, payload: unknown): void;
};

declare global {
  interface Window {
    __ardiaStub?: StubState;
  }
}

const documents = new Map<string, string>();

const engineReplies: Record<string, unknown> = {
  ac_bookmarks_tree: { bar: { id: "bar", k: "f", t: "Bookmarks Bar", a: 0, c: [] }, other: { id: "other", k: "f", t: "Other Bookmarks", a: 0, c: [] } },
  ac_history_query: { entries: [] },
  ac_battery_saver: { mode: "off", state: "off", active: false },
};

const defaultReplies: Record<string, StubReply> = {
  "ArdiaApp.systemInfo": () => ({ appVersion: "0.0.0", buildNumber: "0", osVersion: "Linux", arch: "x64", model: "Linux", locale: "en-US" }),
  "ArdiaApp.launchEnvironment": null,
  "ArdiaApp.killSwitchEnvironment": null,
  "ArdiaShell.windowIds": () => [],
  "ArdiaExtensions.list": () => ({ extensions: [] }),
  "ArdiaCEF.engineCall": (name: unknown) => JSON.stringify(engineReplies[String(name)] ?? {}),
  "ArdiaCEF.systemState": () => ({ onBattery: false, batteryLevel: null, lowPowerMode: false, memoryPressure: "normal", physicalMemory: 16 * 2 ** 30 }),
  "ArdiaCEF.engineInfo": () => ({ pid: 1, dataDirectory: "/tmp/ardia-stub", engine: "stub", chromiumVersion: "155.0.0.0", liveBrowsers: 0, popupWindows: 0, chromeWindows: 0 }),
  "ArdiaCEF.tabStrips": () => ({ rev: 0, cmd: null, strips: [] }),
  "ArdiaApp.updaterState": () => ({ available: false, configured: false, automaticChecks: false, automaticDownloads: false, channel: "stable" }),
  "ArdiaExtensions.searchEngineList": () => ({ list: [] }),
  "ArdiaShell.openWindow": (windowId: unknown) => {
    setTimeout(() => window.__ardiaNativeOpenWindowDocument?.(String(windowId)), 0);
    return null;
  },
  "ArdiaShell.readDocument": (name: unknown) => documents.get(String(name)) ?? null,
  "ArdiaShell.writeDocument": (name: unknown, contents: unknown) => {
    documents.set(String(name), String(contents));
    return null;
  },
  "ArdiaShell.saveDocument": (name: unknown, contents: unknown) => {
    documents.set(String(name), String(contents));
    return null;
  },
};

const listeners = new Map<string, Set<ModuleListener>>();
const viewListeners = new Map<number, ViewListener>();
let nextViewId = 1;

const state: StubState = {
  calls: [],
  replies: { ...defaultReplies },
  constants: { ArdiaApp: { apiVersion: 12 } },
  views: new Map(),
  documents,
  emit(module, event, payload) {
    for (const listener of [...(listeners.get(`${module}.${event}`) ?? [])]) listener(payload);
  },
  emitView(viewId, event, payload) {
    viewListeners.get(viewId)?.(event, payload);
  },
};

const reply = (module: string, method: string, args: unknown[], sync: boolean) => {
  state.calls.push({ module, method, args, sync });
  const key = `${module}.${method}`;
  if (!(key in state.replies)) return null;
  const value = state.replies[key];
  return typeof value === "function" ? (value as (...args: unknown[]) => unknown)(...args) : value;
};

const stub: ArdiaNative = {
  constants: () => state.constants,
  callSync: (module, method, args) => reply(module, method, args, true),
  call: async (module, method, args) => reply(module, method, args, false),
  addListener(module, event, listener) {
    const key = `${module}.${event}`;
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(listener);
    return { remove: () => set.delete(listener) };
  },
  createView(manager, props, listener) {
    const viewId = nextViewId++;
    viewListeners.set(viewId, listener);
    state.views.set(viewId, { manager, props, update: {} });
    return viewId;
  },
  updateView(viewId, update) {
    const view = state.views.get(viewId);
    if (view) view.update = { ...view.update, ...update };
  },
  destroyView(viewId) {
    viewListeners.delete(viewId);
    state.views.delete(viewId);
  },
  callView: async (manager, viewId, method, args) => reply(`${manager}.view`, method, [viewId, ...args], false),
};

window.ardiaNative = stub;
window.__ardiaStub = state;
