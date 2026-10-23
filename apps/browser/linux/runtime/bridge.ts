export type NativeError = { code: string; message: string };

export type NativeReply = { ok: unknown } | { error: NativeError };

export type ViewFrame = { x: number; y: number; width: number; height: number };

export type ViewUpdate = {
  frame?: ViewFrame;
  clip?: ViewFrame | null;
  props?: Record<string, unknown>;
  visible?: boolean;
  order?: number;
};

export type ModuleListener = (payload: unknown) => void;
export type ViewListener = (event: string, payload: unknown) => void;

export type ArdiaNative = {
  constants(): Record<string, Record<string, unknown>>;
  callSync(module: string, method: string, args: unknown[]): unknown;
  call(module: string, method: string, args: unknown[]): Promise<unknown>;
  addListener(module: string, event: string, listener: ModuleListener): { remove(): void };
  createView(manager: string, props: Record<string, unknown>, listener: ViewListener): number;
  updateView(viewId: number, update: ViewUpdate): void;
  destroyView(viewId: number): void;
  callView(manager: string, viewId: number, method: string, args: unknown[]): Promise<unknown>;
};

declare global {
  interface Window {
    ardiaNative?: ArdiaNative;
    __ardiaNativeEmit?: (module: string, event: string, payload: unknown) => void;
    __ardiaNativeViewEmit?: (viewId: number, event: string, payload: unknown) => void;
  }
}

const SCHEME = "ardia-native:";

class NativeCallError extends Error {
  code: string;
  constructor(error: NativeError) {
    super(error.message);
    this.code = error.code;
  }
}

const unwrap = (reply: NativeReply): unknown => {
  if ("error" in reply) throw new NativeCallError(reply.error);
  return reply.ok;
};

const callUrl = (module: string, method: string) =>
  `${SCHEME}//call/${encodeURIComponent(module)}/${encodeURIComponent(method)}`;

export function createSchemeBridge(): ArdiaNative {
  const moduleListeners = new Map<string, Set<ModuleListener>>();
  const viewListeners = new Map<number, ViewListener>();
  let nextViewId = 1;
  let constantsCache: Record<string, Record<string, unknown>> | null = null;

  const callSync = (module: string, method: string, args: unknown[]) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", callUrl(module, method), false);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify(args));
    return unwrap(JSON.parse(xhr.responseText) as NativeReply);
  };

  const call = async (module: string, method: string, args: unknown[]) => {
    const response = await fetch(callUrl(module, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    return unwrap((await response.json()) as NativeReply);
  };

  window.__ardiaNativeEmit = (module, event, payload) => {
    const listeners = moduleListeners.get(`${module}\u0000${event}`);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(payload);
  };
  window.__ardiaNativeViewEmit = (viewId, event, payload) => viewListeners.get(viewId)?.(event, payload);

  return {
    constants() {
      if (!constantsCache) {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", `${SCHEME}//constants`, false);
        xhr.send();
        constantsCache = JSON.parse(xhr.responseText) as Record<string, Record<string, unknown>>;
      }
      return constantsCache;
    },
    callSync,
    call,
    addListener(module, event, listener) {
      const key = `${module}\u0000${event}`;
      let listeners = moduleListeners.get(key);
      if (!listeners) moduleListeners.set(key, (listeners = new Set()));
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    createView(manager, props, listener) {
      const viewId = nextViewId++;
      viewListeners.set(viewId, listener);
      callSync("ArdiaViews", "create", [manager, viewId, props]);
      return viewId;
    },
    updateView(viewId, update) {
      void call("ArdiaViews", "update", [viewId, update]);
    },
    destroyView(viewId) {
      viewListeners.delete(viewId);
      void call("ArdiaViews", "destroy", [viewId]);
    },
    callView(manager, viewId, method, args) {
      return call(`${manager}.view`, method, [viewId, ...args]);
    },
  };
}

export function ardiaNative(): ArdiaNative {
  if (!window.ardiaNative) window.ardiaNative = createSchemeBridge();
  return window.ardiaNative;
}
