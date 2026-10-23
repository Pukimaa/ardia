import { createElement, forwardRef, useCallback, useRef, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { unstable_batchedUpdates as batchedUpdates } from "react-dom";
import {
  Animated as WebAnimated,
  Image as WebImage,
  LogBox as WebLogBox,
  NativeModules as WebNativeModules,
  Pressable as WebPressable,
  ScrollView as WebScrollView,
  Text as WebText,
  TextInput as WebTextInput,
  View as WebView,
} from "react-native-web";
import { viewManagersMetadata } from "./expoModules";
import { findNodeHandle, tagOf } from "./nodeTags";
import { eachWindow, windows } from "./windowHub";

export * from "react-native-web";
export { ColorWithSystemEffectMacOS, DynamicColorMacOS, PlatformColor } from "./platformColors";
export { findNodeHandle };

type Props = Record<string, unknown> & { children?: ReactNode };

type HandledKey = string | { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; capsLockKey?: boolean };

type KeyHandler = (event: MacKeyEvent) => void;

type MacKeyEvent = {
  type: string;
  nativeEvent: Record<string, unknown>;
  target: unknown;
  currentTarget: unknown;
  timeStamp: number;
  preventDefault(): void;
  stopPropagation(): void;
  isDefaultPrevented(): boolean;
  isPropagationStopped(): boolean;
};

const MAC_ONLY_PROPS = new Set([
  "tooltip",
  "enableFocusRing",
  "keyDownEvents",
  "keyUpEvents",
  "validKeysDown",
  "validKeysUp",
  "passthroughAllKeyEvents",
  "mouseDownCanMoveWindow",
  "acceptsFirstMouse",
  "allowsVibrancy",
  "draggedTypes",
  "onDragEnter",
  "onDragLeave",
  "onDrop",
  "onKeyDown",
  "onKeyUp",
  "onPreferredScrollerStyleDidChange",
  "onScrollKeyDown",
  "submitKeyEvents",
  "clearTextOnSubmit",
  "hasHorizontalScroller",
  "hasVerticalScroller",
  "invertsScrollerColors",
]);

const hasMacProps = (props: Props) => {
  for (const key in props) if (MAC_ONLY_PROPS.has(key)) return true;
  return false;
};

const matchesKey = (handled: HandledKey, event: globalThis.KeyboardEvent) => {
  if (typeof handled === "string") return handled === event.key;
  return (
    handled.key === event.key &&
    !!handled.altKey === event.altKey &&
    !!handled.ctrlKey === event.ctrlKey &&
    !!handled.metaKey === event.metaKey &&
    !!handled.shiftKey === event.shiftKey
  );
};

const targetTag = (target: EventTarget | null) =>
  target && (target as Node).nodeType === 1 ? tagOf(target as Element) : null;

const macKeyEvent = (type: string, event: KeyboardEvent): MacKeyEvent => {
  const dom = event.nativeEvent;
  return {
    type,
    nativeEvent: {
      key: dom.key,
      code: dom.code,
      altKey: dom.altKey,
      ctrlKey: dom.ctrlKey,
      metaKey: dom.metaKey,
      shiftKey: dom.shiftKey,
      capsLockKey: dom.getModifierState?.("CapsLock") ?? false,
      numericPadKey: dom.location === 3,
      functionKey: /^F\d+$/.test(dom.key),
      repeat: dom.repeat,
      isComposing: dom.isComposing,
      target: targetTag(dom.target),
      text: (dom.target as HTMLInputElement | null)?.value,
    },
    target: event.target,
    currentTarget: event.currentTarget,
    timeStamp: event.timeStamp,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
    isDefaultPrevented: () => event.isDefaultPrevented(),
    isPropagationStopped: () => event.isPropagationStopped(),
  };
};

const keyListener = (type: string, handler: unknown, handled: unknown) => {
  if (typeof handler !== "function") return undefined;
  const keys = Array.isArray(handled) ? (handled as HandledKey[]) : null;
  return (event: KeyboardEvent) => {
    if (keys) {
      if (!keys.some((key) => matchesKey(key, event.nativeEvent))) return;
      event.preventDefault();
      event.stopPropagation();
    }
    (handler as KeyHandler)(macKeyEvent(type, event));
  };
};

const NO_FOCUS_RING = { outlineStyle: "none" } as const;

const withoutFocusRing = (style: unknown) =>
  typeof style === "function"
    ? (state: unknown) => [(style as (state: unknown) => unknown)(state), NO_FOCUS_RING]
    : [style, NO_FOCUS_RING];

function webProps(props: Props, keyProp: "onKeyDown" | "onKeyPress" = "onKeyDown"): Props {
  if (!hasMacProps(props)) return props;
  const {
    tooltip,
    enableFocusRing,
    keyDownEvents,
    keyUpEvents,
    validKeysDown,
    validKeysUp,
    onKeyDown,
    onKeyUp,
    passthroughAllKeyEvents: _passthroughAllKeyEvents,
    mouseDownCanMoveWindow: _mouseDownCanMoveWindow,
    acceptsFirstMouse: _acceptsFirstMouse,
    allowsVibrancy: _allowsVibrancy,
    draggedTypes: _draggedTypes,
    onDragEnter: _onDragEnter,
    onDragLeave: _onDragLeave,
    onDrop: _onDrop,
    onPreferredScrollerStyleDidChange: _onPreferredScrollerStyleDidChange,
    onScrollKeyDown: _onScrollKeyDown,
    submitKeyEvents: _submitKeyEvents,
    clearTextOnSubmit: _clearTextOnSubmit,
    hasHorizontalScroller: _hasHorizontalScroller,
    hasVerticalScroller: _hasVerticalScroller,
    invertsScrollerColors: _invertsScrollerColors,
    ...rest
  } = props;
  const out: Props = rest;
  if (typeof tooltip === "string" && tooltip) out.title = tooltip;
  if (enableFocusRing === false) out.style = withoutFocusRing(rest.style);
  const down = keyListener("keyDown", onKeyDown, keyDownEvents ?? validKeysDown);
  if (down) {
    const previous = rest[keyProp] as ((event: KeyboardEvent) => void) | undefined;
    out[keyProp] = previous
      ? (event: KeyboardEvent) => {
          previous(event);
          down(event);
        }
      : down;
  }
  const up = keyListener("keyUp", onKeyUp, keyUpEvents ?? validKeysUp);
  if (up) out.onKeyUp = up;
  return out;
}

type DroppedFile = { name: string; type: string; size: number; uri?: string };

const filePath = (file: File) => {
  const native = (globalThis as { ardiaNativeFilePath?: (file: File) => string | null }).ardiaNativeFilePath;
  return native?.(file) ?? (file as File & { path?: string }).path ?? null;
};

const dataTransferOf = (event: DragEvent) => {
  const transfer = event.dataTransfer;
  const files: DroppedFile[] = [...(transfer?.files ?? [])].map((file) => {
    const path = filePath(file);
    return { name: file.name, type: file.type, size: file.size, uri: path ? `file://${encodeURI(path)}` : undefined };
  });
  return { files, items: files.map((file) => ({ kind: "file", type: file.type })), types: [...(transfer?.types ?? [])] };
};

const macDragEvent = (event: DragEvent) => ({
  nativeEvent: { dataTransfer: dataTransferOf(event), clientX: event.clientX, clientY: event.clientY, target: targetTag(event.target) },
  target: event.target,
  preventDefault: () => event.preventDefault(),
  stopPropagation: () => event.stopPropagation(),
});

type DragHandler = (event: ReturnType<typeof macDragEvent>) => void;

const DropTargetView = forwardRef<unknown, Props>(function DropTargetView(props, ref) {
  const depth = useRef(0);
  const { onDragEnter, onDragLeave, onDrop } = props as { onDragEnter?: DragHandler; onDragLeave?: DragHandler; onDrop?: DragHandler };
  return createElement(WebView, {
    ...webProps(props),
    ref,
    onDragEnter: (event: DragEvent) => {
      event.preventDefault();
      if (depth.current++ === 0) onDragEnter?.(macDragEvent(event));
    },
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: DragEvent) => {
      if (depth.current > 0 && --depth.current === 0) onDragLeave?.(macDragEvent(event));
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      depth.current = 0;
      onDrop?.(macDragEvent(event));
    },
  });
});

const isDropTarget = (props: Props) => props.draggedTypes != null || props.onDrop != null;

export const View = forwardRef<unknown, Props>(function View(props, ref) {
  if (isDropTarget(props)) return createElement(DropTargetView, { ...props, ref });
  return createElement(WebView, { ...webProps(props), ref });
});

export const Text = forwardRef<unknown, Props>(function Text(props, ref) {
  const mapped = webProps(props);
  return createElement(WebText, { ...mapped, selectable: mapped.selectable ?? false, ref });
});

export const Pressable = forwardRef<unknown, Props>(function Pressable(props, ref) {
  return createElement(WebPressable, { ...webProps(props), ref });
});

export const ScrollView = forwardRef<unknown, Props>(function ScrollView(props, ref) {
  return createElement(WebScrollView, { ...webProps(props), ref });
});

export const Image = Object.assign(
  forwardRef<unknown, Props>(function Image(props, ref) {
    return createElement(WebImage, { ...webProps(props), ref });
  }),
  {
    getSize: WebImage.getSize,
    getSizeWithHeaders: WebImage.getSizeWithHeaders,
    prefetch: WebImage.prefetch,
    queryCache: WebImage.queryCache,
  },
);

type TextField = HTMLInputElement & { setSelection?: (start: number, end: number) => void };

const withSelection = (node: TextField | null) => {
  if (node && !node.setSelection) node.setSelection = (start, end) => node.setSelectionRange(start, end);
  return node;
};

const assignRef = (ref: unknown, value: unknown) => {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object") (ref as { current: unknown }).current = value;
};

export const TextInput = Object.assign(
  forwardRef<unknown, Props>(function TextInput(props, ref) {
    const setRef = useCallback((node: TextField | null) => assignRef(ref, withSelection(node)), [ref]);
    return createElement(WebTextInput, { ...webProps(props, "onKeyPress"), ref: setRef });
  }),
  { State: WebTextInput.State },
);

export const Animated = {
  ...WebAnimated,
  View: WebAnimated.createAnimatedComponent(View),
  Text: WebAnimated.createAnimatedComponent(Text),
  ScrollView: WebAnimated.createAnimatedComponent(ScrollView),
  Image: WebAnimated.createAnimatedComponent(Image),
};

type AppStateStatus = "active" | "inactive";
type AppStateListener = (state: AppStateStatus) => void;

const appStateListeners = new Set<AppStateListener>();
let appState: AppStateStatus = "active";

const focusedAppState = (): AppStateStatus => {
  const docs = windows().filter((win) => win !== window);
  return docs.length === 0 || docs.some((win) => win.document.hasFocus()) ? "active" : "inactive";
};

const refreshAppState = () =>
  setTimeout(() => {
    const next = focusedAppState();
    if (next === appState) return;
    appState = next;
    for (const listener of [...appStateListeners]) listener(next);
  }, 0);

eachWindow((win) => {
  win.addEventListener("focus", refreshAppState);
  win.addEventListener("blur", refreshAppState);
  win.addEventListener("pagehide", refreshAppState);
});

export const AppState = {
  isAvailable: true,
  get currentState(): AppStateStatus {
    return appState;
  },
  addEventListener(type: string, listener: AppStateListener) {
    if (type !== "change") return { remove: () => {} };
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  },
};

export const unstable_batchedUpdates = batchedUpdates;

export const LogBox = {
  ...WebLogBox,
  ignoreLogs: (_patterns: unknown[]) => {},
  ignoreAllLogs: (_ignore?: boolean) => {},
  install: () => {},
  uninstall: () => {},
};

export const NativeModules: Record<string, unknown> = {
  ...WebNativeModules,
  NativeUnimoduleProxy: {
    get viewManagersMetadata() {
      return viewManagersMetadata();
    },
    modulesConstants: {},
  },
};

export const TurboModuleRegistry = {
  get: (_name: string) => null,
  getEnforcing: (name: string) => {
    throw new Error(`TurboModuleRegistry.getEnforcing(...): '${name}' could not be found on Linux.`);
  },
};

export const DeviceInfo = { getConstants: () => ({ isTesting: false }) };

export const DevSettings = { addMenuItem: () => {}, reload: () => location.reload() };

export function requireNativeComponent(name: string) {
  throw new Error(`requireNativeComponent('${name}') is not available on Linux`);
}
