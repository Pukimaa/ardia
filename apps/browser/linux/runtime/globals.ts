import { eachWindow } from "./windowHub";

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

const target = globalThis as Record<string, unknown>;

target.__ARDIA_PLATFORM__ = "linux";
target.global ??= globalThis;

let globalHandler: GlobalHandler = (error) => {
  console.error(error);
};

target.ErrorUtils ??= {
  getGlobalHandler: () => globalHandler,
  setGlobalHandler: (handler: GlobalHandler) => {
    globalHandler = handler;
  },
  reportError: (error: unknown) => globalHandler(error, false),
  reportFatalError: (error: unknown) => globalHandler(error, true),
};

const reported = new WeakSet<object>();

const report = (error: unknown, isFatal: boolean) => {
  if (error && typeof error === "object") {
    if (reported.has(error)) return;
    reported.add(error);
  }
  try {
    globalHandler(error, isFatal);
  } catch {}
};

eachWindow((win) => {
  win.addEventListener("error", (event) => report(event.error ?? new Error(event.message), false));
  win.addEventListener("unhandledrejection", (event) => report(event.reason, false));
});

if (typeof target.setImmediate !== "function") {
  const { port1, port2 } = new MessageChannel();
  const queue = new Map<number, () => void>();
  let nextId = 1;
  port1.onmessage = (event: MessageEvent<number>) => {
    const run = queue.get(event.data);
    queue.delete(event.data);
    run?.();
  };
  target.setImmediate = (callback: (...args: unknown[]) => void, ...args: unknown[]) => {
    const id = nextId++;
    queue.set(id, () => callback(...args));
    port2.postMessage(id);
    return id;
  };
  target.clearImmediate = (id: number) => {
    queue.delete(id);
  };
}
