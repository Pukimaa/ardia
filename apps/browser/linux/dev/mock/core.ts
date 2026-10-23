import type { ModuleListener, ViewListener } from "../../runtime/bridge";

export type Handler = (...args: unknown[]) => unknown;
export type HandlerTable = Record<string, Record<string, Handler>>;

export type MockCall = { module: string; method: string; args: unknown[]; sync: boolean; at: number };

export type MockOptions = {
  persist?: "memory" | "localStorage";
  documents?: Record<string, string>;
  env?: Record<string, string>;
  dark?: boolean;
  isolatedInstance?: boolean;
  callLog?: number;
  latencyMs?: number;
  autoConfirm?: boolean | null;
};

declare global {
  interface Window {
    __ardiaMockOptions?: MockOptions;
  }
}

export class MockError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const readQueryOptions = (): MockOptions => {
  const out: MockOptions = {};
  try {
    const query = new URLSearchParams(location.search);
    if (query.get("persist") === "memory") out.persist = "memory";
    if (query.has("dark")) out.dark = query.get("dark") !== "0";
    if (query.has("probe")) out.isolatedInstance = true;
    if (query.has("fresh")) {
      for (const key of Object.keys(localStorage)) if (key.startsWith(DOCUMENT_PREFIX)) localStorage.removeItem(key);
    }
  } catch {}
  return out;
};

const DOCUMENT_PREFIX = "ardia-mock-doc:";

export const options: MockOptions = { ...readQueryOptions(), ...window.__ardiaMockOptions };

const memoryDocuments = new Map<string, string>();

export const documents = {
  get(name: string): string | null {
    if (options.persist === "memory") return memoryDocuments.get(name) ?? null;
    try {
      return localStorage.getItem(DOCUMENT_PREFIX + name);
    } catch {
      return memoryDocuments.get(name) ?? null;
    }
  },
  set(name: string, contents: string) {
    memoryDocuments.set(name, contents);
    if (options.persist === "memory") return;
    try {
      localStorage.setItem(DOCUMENT_PREFIX + name, contents);
    } catch {}
  },
  remove(name: string) {
    memoryDocuments.delete(name);
    if (options.persist === "memory") return;
    try {
      localStorage.removeItem(DOCUMENT_PREFIX + name);
    } catch {}
  },
  names(): string[] {
    const names = new Set(memoryDocuments.keys());
    if (options.persist !== "memory") {
      try {
        for (const key of Object.keys(localStorage)) if (key.startsWith(DOCUMENT_PREFIX)) names.add(key.slice(DOCUMENT_PREFIX.length));
      } catch {}
    }
    return [...names].sort();
  },
};

for (const [name, contents] of Object.entries(options.documents ?? {})) documents.set(name, contents);

const moduleListeners = new Map<string, Set<ModuleListener>>();
export const viewListeners = new Map<number, ViewListener>();

export function addModuleListener(module: string, event: string, listener: ModuleListener) {
  const key = `${module}\u0000${event}`;
  let listeners = moduleListeners.get(key);
  if (!listeners) moduleListeners.set(key, (listeners = new Set()));
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}

const clone = <T>(value: T): T => (value === undefined ? (null as T) : (JSON.parse(JSON.stringify(value)) as T));

export const emitted: { module: string; event: string; payload: unknown; at: number }[] = [];

export function emit(module: string, event: string, payload: unknown) {
  const sent = clone(payload);
  emitted.push({ module, event, payload: sent, at: Date.now() });
  if (emitted.length > 2000) emitted.splice(0, emitted.length - 2000);
  for (const listener of [...(moduleListeners.get(`${module}\u0000${event}`) ?? [])]) {
    try {
      listener(sent);
    } catch (error) {
      console.error(error);
    }
  }
}

export function emitView(viewId: number, event: string, payload: unknown) {
  const listener = viewListeners.get(viewId);
  if (!listener) return;
  try {
    listener(event, clone(payload));
  } catch (error) {
    console.error(error);
  }
}

export const later = (ms: number, run: () => void) => window.setTimeout(run, ms);

export const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export const now = () => Date.now();

export function hashOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const pngCache = new Map<string, string>();

export function letterIcon(text: string, size = 32): string {
  const key = `${text}:${size}`;
  const cached = pngCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return "";
  const hue = hashOf(text) % 360;
  context.fillStyle = `hsl(${hue} 62% 48%)`;
  context.beginPath();
  context.roundRect(0, 0, size, size, size * 0.22);
  context.fill();
  context.fillStyle = "#fff";
  context.font = `600 ${Math.round(size * 0.58)}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText((text.replace(/^www\./, "")[0] ?? "?").toUpperCase(), size / 2, size / 2 + size * 0.04);
  const png = canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
  pngCache.set(key, png);
  return png;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function originOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null" ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
  } catch {
    return "";
  }
}

export const prefersDark = () => options.dark ?? window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
