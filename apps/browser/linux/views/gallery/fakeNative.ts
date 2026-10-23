import type { ArdiaNative, ViewListener, ViewUpdate } from "../../runtime/bridge";

export type RecordedCall =
  | { kind: "createView"; manager: string; viewId: number; props: Record<string, unknown>; at: number }
  | { kind: "updateView"; viewId: number; update: ViewUpdate; at: number }
  | { kind: "destroyView"; viewId: number; at: number }
  | { kind: "callView"; manager: string; viewId: number; method: string; args: unknown[]; at: number }
  | { kind: "call" | "callSync"; module: string; method: string; args: unknown[]; at: number };

export type FakeNative = ArdiaNative & {
  calls: RecordedCall[];
  frame: number;
  emitView(viewId: number, event: string, payload: unknown): void;
  emit(module: string, event: string, payload: unknown): void;
  reset(): void;
};

declare global {
  interface Window {
    __ardiaFakeNative?: FakeNative;
  }
}

export function installFakeNative(): FakeNative {
  const listeners = new Map<number, ViewListener>();
  const moduleListeners = new Map<string, Set<(payload: unknown) => void>>();
  let nextViewId = 1;
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const fake: FakeNative = {
    calls: [],
    frame: 0,
    constants: () => ({}),
    callSync(module, method, args) {
      fake.calls.push({ kind: "callSync", module, method, args: clone(args), at: fake.frame });
      return null;
    },
    async call(module, method, args) {
      fake.calls.push({ kind: "call", module, method, args: clone(args), at: fake.frame });
      return null;
    },
    addListener(module, event, listener) {
      const key = `${module}.${event}`;
      let set = moduleListeners.get(key);
      if (!set) moduleListeners.set(key, (set = new Set()));
      set.add(listener);
      return { remove: () => set.delete(listener) };
    },
    createView(manager, props, listener) {
      const viewId = nextViewId++;
      listeners.set(viewId, listener);
      fake.calls.push({ kind: "createView", manager, viewId, props: clone(props), at: fake.frame });
      return viewId;
    },
    updateView(viewId, update) {
      fake.calls.push({ kind: "updateView", viewId, update: clone(update), at: fake.frame });
    },
    destroyView(viewId) {
      listeners.delete(viewId);
      fake.calls.push({ kind: "destroyView", viewId, at: fake.frame });
    },
    async callView(manager, viewId, method, args) {
      fake.calls.push({ kind: "callView", manager, viewId, method, args: clone(args), at: fake.frame });
      return `${method}:${viewId}`;
    },
    emitView(viewId, event, payload) {
      listeners.get(viewId)?.(event, payload);
    },
    emit(module, event, payload) {
      for (const listener of [...(moduleListeners.get(`${module}.${event}`) ?? [])]) listener(payload);
    },
    reset() {
      fake.calls.length = 0;
    },
  };
  const countFrames = () => {
    fake.frame++;
    requestFrame(countFrames);
  };
  const requestFrame = window.requestAnimationFrame.bind(window);
  requestFrame(countFrames);
  window.ardiaNative = fake;
  window.__ardiaFakeNative = fake;
  return fake;
}
