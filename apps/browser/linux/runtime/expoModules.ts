import { createElement, forwardRef, type ComponentType } from "react";
import { ardiaNative } from "./bridge";
import { moduleSpec, type ModuleSpec } from "./moduleSpec.generated";
import { viewManager, viewManagerNames } from "./viewRegistry";

export type EventSubscription = { remove(): void };

type Listener = (...args: unknown[]) => void;

export class EventEmitter<_Events = Record<string, Listener>> {
  private listenersByEvent = new Map<string, Set<Listener>>();

  addListener(eventName: string, listener: Listener): EventSubscription {
    let listeners = this.listenersByEvent.get(eventName);
    if (!listeners) this.listenersByEvent.set(eventName, (listeners = new Set()));
    const first = listeners.size === 0;
    listeners.add(listener);
    if (first) this.startObserving(eventName);
    return { remove: () => this.removeListener(eventName, listener) };
  }

  removeListener(eventName: string, listener: Listener) {
    const listeners = this.listenersByEvent.get(eventName);
    if (!listeners?.delete(listener)) return;
    if (listeners.size === 0) this.stopObserving(eventName);
  }

  removeAllListeners(eventName: string) {
    const listeners = this.listenersByEvent.get(eventName);
    if (!listeners?.size) return;
    listeners.clear();
    this.stopObserving(eventName);
  }

  emit(eventName: string, ...args: unknown[]) {
    const listeners = this.listenersByEvent.get(eventName);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(...args);
  }

  listenerCount(eventName: string): number {
    return this.listenersByEvent.get(eventName)?.size ?? 0;
  }

  startObserving(_eventName: string) {}

  stopObserving(_eventName: string) {}
}

export class NativeModule<Events = Record<string, Listener>> extends EventEmitter<Events> {
  ViewPrototypes?: Record<string, object>;
}

export class SharedObject<Events = Record<string, Listener>> extends EventEmitter<Events> {
  release() {}
}

export class SharedRef<_Type = unknown, Events = Record<string, Listener>> extends SharedObject<Events> {
  nativeRefType = "unknown";
}

export class CodedError extends Error {
  code: string;
  info?: unknown;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class UnavailabilityError extends CodedError {
  constructor(moduleName: string, propertyName: string) {
    super("ERR_UNAVAILABLE", `The method or property ${moduleName}.${propertyName} is not available on Linux.`);
  }
}

export const Platform = {
  OS: "linux" as const,
  isDOMAvailable: true,
  canUseEventListeners: true,
  canUseViewport: true,
  isAsyncDebugging: false,
  select<T>(specifics: { linux?: T; web?: T; native?: T; default?: T }): T | undefined {
    return specifics.linux ?? specifics.web ?? specifics.native ?? specifics.default;
  },
};

const constantsOf = (name: string): Record<string, unknown> => ardiaNative().constants()[name] ?? {};

const EMITTER_KEYS = new Set(["addListener", "removeListener", "removeAllListeners", "emit", "listenerCount", "startObserving", "stopObserving"]);

class LinuxNativeModule extends NativeModule {
  private nativeSubscriptions = new Map<string, { remove(): void }>();

  constructor(readonly moduleName: string) {
    super();
  }

  override startObserving(eventName: string) {
    if (this.nativeSubscriptions.has(eventName)) return;
    const subscription = ardiaNative().addListener(this.moduleName, eventName, (payload) => this.emit(eventName, payload));
    this.nativeSubscriptions.set(eventName, subscription);
  }

  override stopObserving(eventName: string) {
    this.nativeSubscriptions.get(eventName)?.remove();
    this.nativeSubscriptions.delete(eventName);
  }
}

const createModule = (name: string, spec: ModuleSpec | undefined): object => {
  const module = new LinuxNativeModule(name);
  const methods = new Map<string, (...args: unknown[]) => unknown>();
  for (const [method, kind] of Object.entries(spec?.methods ?? {})) {
    methods.set(
      method,
      kind === "sync"
        ? (...args: unknown[]) => ardiaNative().callSync(name, method, args)
        : (...args: unknown[]) => ardiaNative().call(name, method, args),
    );
  }
  return new Proxy(module, {
    get(target, key, receiver) {
      if (typeof key !== "string") return Reflect.get(target, key, receiver);
      if (EMITTER_KEYS.has(key)) {
        const value = Reflect.get(target, key, receiver) as Listener;
        return value.bind(target);
      }
      const method = methods.get(key);
      if (method) return method;
      if (key in target) return Reflect.get(target, key, receiver);
      const constants = constantsOf(name);
      if (key in constants) return constants[key];
      return undefined;
    },
    has(target, key) {
      if (typeof key !== "string") return key in target;
      return methods.has(key) || key in target || key in constantsOf(name);
    },
  });
};

const modules = new Map<string, object>();

const moduleExists = (name: string) => name in moduleSpec || name in ardiaNative().constants();

export function requireOptionalNativeModule<ModuleType = unknown>(moduleName: string): ModuleType | null {
  let module = modules.get(moduleName);
  if (!module) {
    if (!moduleExists(moduleName)) return null;
    module = createModule(moduleName, moduleSpec[moduleName]);
    modules.set(moduleName, module);
  }
  return module as ModuleType;
}

export function requireNativeModule<ModuleType = unknown>(moduleName: string): ModuleType {
  const module = requireOptionalNativeModule<ModuleType>(moduleName);
  if (module == null) throw new Error(`Cannot find native module '${moduleName}'`);
  return module;
}

export function requireNativeViewManager<P = Record<string, unknown>>(moduleName: string, viewName?: string): ComponentType<P> {
  const managerName = viewName ? `${moduleName}_${viewName}` : moduleName;
  const NativeView = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    const Component = viewManager(managerName) ?? (viewName ? undefined : viewManager(moduleName));
    if (!Component) throw new Error(`No web view is registered for the native view manager '${managerName}' (apps/browser/linux/views)`);
    return createElement(Component, { ...props, ref });
  });
  NativeView.displayName = `ViewManagerAdapter_${managerName}`;
  return NativeView as unknown as ComponentType<P>;
}

export function viewConfig(name: string) {
  if (!viewManager(name)) return null;
  const view = moduleSpec[name]?.view;
  return {
    validAttributes: Object.fromEntries((view?.props ?? []).map((prop) => [prop, true])),
    directEventTypes: Object.fromEntries((view?.events ?? []).map((event) => [`top${event.replace(/^on/, "")}`, { registrationName: event }])),
  };
}

export function viewManagersMetadata(): Record<string, { propsNames: string[] }> {
  return Object.fromEntries(viewManagerNames().map((name) => [name, { propsNames: moduleSpec[name]?.view?.props ?? [] }]));
}

export const NativeModulesProxy: Record<string, object> = new Proxy({} as Record<string, object>, {
  get: (_target, key) => (typeof key === "string" ? (requireOptionalNativeModule<object>(key) ?? undefined) : undefined),
  has: (_target, key) => typeof key === "string" && moduleExists(key),
});

export function registerWebModule<T extends new () => object>(moduleImplementation: T, moduleName: string) {
  const instance = new moduleImplementation();
  modules.set(moduleName, instance);
  return instance;
}

export function uuidv4(): string {
  return crypto.randomUUID();
}

export const uuid = { v4: uuidv4 };

export function reloadAppAsync(_reason?: string): Promise<void> {
  location.reload();
  return Promise.resolve();
}

export function installExpoGlobal() {
  const target = globalThis as { expo?: Record<string, unknown> };
  target.expo = {
    ...target.expo,
    modules: NativeModulesProxy,
    EventEmitter,
    NativeModule,
    SharedObject,
    SharedRef,
    getViewConfig: viewConfig,
    uuidv4,
  };
}
