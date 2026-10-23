import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Appearance, useColorScheme } from "react-native-web";
import { moduleSpec } from "../runtime/moduleSpec.generated";

export type ViewProps = Record<string, unknown> & { children?: React.ReactNode; style?: unknown };

export type NativeEventHandler = (event: SyntheticNativeEvent) => void;

export type SyntheticNativeEvent = {
  nativeEvent: unknown;
  type: string;
  target: Element | null;
  currentTarget: Element | null;
  timeStamp: number;
  preventDefault(): void;
  stopPropagation(): void;
  isDefaultPrevented(): boolean;
  isPropagationStopped(): boolean;
  persist(): void;
};

export const WEIGHTS: Record<string, number> = { light: 300, regular: 400, medium: 500, semibold: 600, bold: 700 };

export const SYSTEM_FONT = 'system-ui,-apple-system,BlinkMacSystemFont,Inter,Cantarell,Ubuntu,"Noto Sans","DejaVu Sans",sans-serif';

export type RGBA = [number, number, number, number];

export function parseHex(hex: unknown): RGBA | null {
  if (typeof hex !== "string") return null;
  let s = hex.trim();
  if (s.startsWith("#")) s = s.slice(1);
  if ((s.length !== 6 && s.length !== 8) || !/^[0-9a-fA-F]+$/.test(s)) return null;
  const v = parseInt(s.length === 6 ? `${s}ff` : s, 16);
  return [((v >>> 24) & 0xff) / 255, ((v >>> 16) & 0xff) / 255, ((v >>> 8) & 0xff) / 255, (v & 0xff) / 255];
}

const channel = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);

export function cssColor(color: RGBA | null, alpha = 1): string | undefined {
  if (!color) return undefined;
  return `rgba(${channel(color[0])},${channel(color[1])},${channel(color[2])},${+(color[3] * alpha).toFixed(4)})`;
}

export function cssHex(hex: unknown, alpha = 1): string | undefined {
  return cssColor(parseHex(hex), alpha);
}

export function useDark(forced?: boolean | null): boolean {
  const scheme = useColorScheme();
  if (typeof forced === "boolean") return forced;
  return (scheme ?? Appearance.getColorScheme()) === "dark";
}

export function splitProps(manager: string, props: ViewProps) {
  const view = moduleSpec[manager]?.view;
  const own: Record<string, unknown> = {};
  const rest: ViewProps = {};
  const names = new Set([...(view?.props ?? []), ...(view?.events ?? [])]);
  for (const [key, value] of Object.entries(props)) {
    if (names.has(key)) own[key] = value;
    else rest[key] = value;
  }
  return { own, rest };
}

export function syntheticEvent(type: string, nativeEvent: unknown, target: Element | null): SyntheticNativeEvent {
  let prevented = false;
  let stopped = false;
  return {
    nativeEvent,
    type,
    target,
    currentTarget: target,
    timeStamp: performance.now(),
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
    isDefaultPrevented: () => prevented,
    isPropagationStopped: () => stopped,
    persist: () => {},
  };
}

export function fire(handler: unknown, type: string, payload: unknown, target: Element | null) {
  if (typeof handler === "function") (handler as NativeEventHandler)(syntheticEvent(type, payload, target));
}

export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function hostElement(instance: unknown): HTMLElement | null {
  if (instance && typeof instance === "object" && (instance as Node).nodeType === 1) return instance as HTMLElement;
  return null;
}

export type RealmWindow = Window & typeof globalThis;

export function windowOf(element: Element | null): RealmWindow {
  return (element?.ownerDocument?.defaultView ?? window) as RealmWindow;
}

export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const win = windowOf(element);
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    };
    measure();
    const observer = new win.ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function useDevicePixelRatio(ref: RefObject<HTMLElement | null>): number {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const win = windowOf(ref.current);
    let query: MediaQueryList | null = null;
    const update = () => {
      setRatio(win.devicePixelRatio || 1);
      query?.removeEventListener("change", update);
      query = win.matchMedia(`(resolution: ${win.devicePixelRatio || 1}dppx)`);
      query.addEventListener("change", update);
    };
    update();
    return () => query?.removeEventListener("change", update);
  }, [ref]);
  return ratio;
}

export function useWindowActive(ref: RefObject<HTMLElement | null>): boolean {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const win = windowOf(ref.current);
    const update = () => setActive(win.document.hasFocus());
    update();
    win.addEventListener("focus", update);
    win.addEventListener("blur", update);
    return () => {
      win.removeEventListener("focus", update);
      win.removeEventListener("blur", update);
    };
  }, [ref]);
  return active;
}

export function prefersReducedMotion(element: Element | null): boolean {
  return windowOf(element).matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useMergedRef<T>(forwarded: React.ForwardedRef<T>, local: React.RefObject<T | null>) {
  return useCallback(
    (value: T | null) => {
      local.current = value;
      if (typeof forwarded === "function") forwarded(value);
      else if (forwarded) forwarded.current = value;
    },
    [forwarded, local],
  );
}
