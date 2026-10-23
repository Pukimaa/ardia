import { useImperativeHandle, useLayoutEffect, useRef, type ForwardedRef } from "react";
import { ardiaNative, type ViewFrame, type ViewUpdate } from "../runtime/bridge";
import { moduleSpec } from "../runtime/moduleSpec.generated";
import { WINDOW_NAME_PREFIX } from "../runtime/windowDocuments";
import { fire, splitProps, useLatest, windowOf, type RealmWindow, type ViewProps } from "./common";

type Tracked = { element: HTMLElement; viewId: number; sent: string };

type Placement = Required<Pick<ViewUpdate, "frame" | "clip" | "visible" | "order">>;

const round = (value: number) => Math.round(value * 1000) / 1000;

const rectOf = (x: number, y: number, width: number, height: number): ViewFrame => ({
  x: round(x),
  y: round(y),
  width: round(Math.max(0, width)),
  height: round(Math.max(0, height)),
});

const clipsX = (style: CSSStyleDeclaration) => style.overflowX !== "visible";
const clipsY = (style: CSSStyleDeclaration) => style.overflowY !== "visible";

export function measurePlacement(element: HTMLElement, order: number): Placement {
  const win = windowOf(element);
  const box = element.getBoundingClientRect();
  let left = 0;
  let top = 0;
  let right = win.innerWidth;
  let bottom = win.innerHeight;
  for (let node = element.parentElement; node && node !== win.document.documentElement; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    const x = clipsX(style);
    const y = clipsY(style);
    if (!x && !y) continue;
    const rect = node.getBoundingClientRect();
    const innerLeft = rect.left + node.clientLeft;
    const innerTop = rect.top + node.clientTop;
    if (x) {
      left = Math.max(left, innerLeft);
      right = Math.min(right, innerLeft + (node.clientWidth || rect.width));
    }
    if (y) {
      top = Math.max(top, innerTop);
      bottom = Math.min(bottom, innerTop + (node.clientHeight || rect.height));
    }
  }
  const clipLeft = Math.max(left, box.left);
  const clipTop = Math.max(top, box.top);
  const clipRight = Math.min(right, box.right);
  const clipBottom = Math.min(bottom, box.bottom);
  const visible =
    element.isConnected &&
    (typeof element.checkVisibility === "function" ? element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : box.width > 0);
  return {
    frame: rectOf(box.left, box.top, box.width, box.height),
    clip: rectOf(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop),
    visible,
    order,
  };
}

class DocumentTracker {
  private readonly views = new Set<Tracked>();
  private readonly resize: ResizeObserver;
  private readonly mutations: MutationObserver;
  private frame = 0;
  private readonly win: RealmWindow;

  constructor(readonly doc: Document) {
    this.win = (doc.defaultView ?? window) as RealmWindow;
    this.resize = new this.win.ResizeObserver(() => this.schedule());
    this.mutations = new this.win.MutationObserver(() => this.schedule());
  }

  private readonly onEvent = () => this.schedule();

  private start() {
    this.mutations.observe(this.doc.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.doc.addEventListener("scroll", this.onEvent, { capture: true, passive: true });
    for (const type of ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "animationcancel"]) {
      this.doc.addEventListener(type, this.onEvent, true);
    }
    this.win.addEventListener("resize", this.onEvent);
    this.doc.fonts?.addEventListener?.("loadingdone", this.onEvent);
  }

  private stop() {
    this.mutations.disconnect();
    this.doc.removeEventListener("scroll", this.onEvent, { capture: true });
    for (const type of ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "animationcancel"]) {
      this.doc.removeEventListener(type, this.onEvent, true);
    }
    this.win.removeEventListener("resize", this.onEvent);
    this.doc.fonts?.removeEventListener?.("loadingdone", this.onEvent);
    if (this.frame) this.win.cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  add(view: Tracked) {
    if (this.views.size === 0) this.start();
    this.views.add(view);
    this.resize.observe(view.element);
    this.schedule();
  }

  remove(view: Tracked) {
    if (!this.views.delete(view)) return;
    this.resize.unobserve(view.element);
    if (this.views.size === 0) this.stop();
    else this.schedule();
  }

  schedule() {
    if (this.frame || this.views.size === 0) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  }

  measure() {
    const ordered = [...this.views].sort((a, b) =>
      a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    ordered.forEach((view, order) => {
      const placement = measurePlacement(view.element, order);
      const key = JSON.stringify(placement);
      if (key === view.sent) return;
      view.sent = key;
      ardiaNative().updateView(view.viewId, placement);
    });
    if (this.animating()) this.schedule();
  }

  private animating(): boolean {
    if (typeof this.doc.getAnimations !== "function") return false;
    for (const animation of this.doc.getAnimations()) {
      if (animation.playState !== "running") continue;
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (!target) continue;
      for (const view of this.views) if (target === view.element || target.contains(view.element)) return true;
    }
    return false;
  }
}

const trackers = new WeakMap<Document, DocumentTracker>();

export function trackerFor(doc: Document): DocumentTracker {
  let tracker = trackers.get(doc);
  if (!tracker) trackers.set(doc, (tracker = new DocumentTracker(doc)));
  return tracker;
}

export function windowIdOf(element: Element): string | null {
  const win = windowOf(element);
  try {
    if (win.name.startsWith(WINDOW_NAME_PREFIX)) return win.name.slice(WINDOW_NAME_PREFIX.length);
    if (win.location.pathname.endsWith("/window.html") && win.location.hash.length > 1) return decodeURIComponent(win.location.hash.slice(1));
  } catch {}
  return null;
}

const isSendable = (value: unknown) => typeof value !== "function" && value !== undefined;

const sendableProps = (own: Record<string, unknown>, events: Set<string>) => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(own)) if (!events.has(key) && isSendable(value)) out[key] = value;
  return out;
};

const changedProps = (previous: Record<string, unknown>, next: Record<string, unknown>) => {
  const diff: Record<string, unknown> = {};
  let changed = false;
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const before = previous[key];
    const after = next[key];
    if (before === after || JSON.stringify(before) === JSON.stringify(after)) continue;
    diff[key] = after === undefined ? null : after;
    changed = true;
  }
  return changed ? diff : null;
};

const eventProp = (event: string) => (event.startsWith("on") ? event : `on${event.charAt(0).toUpperCase()}${event.slice(1)}`);

export type NativeViewHandle = Record<string, unknown> & {
  viewId(): number | null;
  getNativeRef(): HTMLElement | null;
  nativeRef: { current: HTMLElement | null };
};

export function useNativeView(manager: string, props: ViewProps, ref: ForwardedRef<unknown>, options: { track?: boolean } = {}) {
  const spec = moduleSpec[manager]?.view;
  const events = new Set(spec?.events ?? []);
  const { own, rest } = splitProps(manager, props);
  const element = useRef<HTMLElement | null>(null);
  const viewId = useRef<number | null>(null);
  const sent = useRef<Record<string, unknown>>({});
  const latest = useLatest(own);
  const track = options.track ?? true;

  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const initial = sendableProps(latest.current, events);
    sent.current = initial;
    const id = ardiaNative().createView(manager, { ...initial, windowId: windowIdOf(node) }, (event, payload) => {
      const name = eventProp(event);
      fire(latest.current[name], name, payload, element.current);
    });
    viewId.current = id;
    node.dataset.ardiaViewId = String(id);
    const tracked: Tracked = { element: node, viewId: id, sent: "" };
    const tracker = track ? trackerFor(node.ownerDocument) : null;
    tracker?.add(tracked);
    return () => {
      tracker?.remove(tracked);
      viewId.current = null;
      if (node.dataset.ardiaViewId === String(id)) delete node.dataset.ardiaViewId;
      ardiaNative().destroyView(id);
    };
  }, [manager, track]);

  useLayoutEffect(() => {
    const id = viewId.current;
    if (id == null) return;
    const next = sendableProps(own, events);
    const diff = changedProps(sent.current, next);
    sent.current = next;
    if (diff) ardiaNative().updateView(id, { props: diff });
  });

  useImperativeHandle(ref, (): NativeViewHandle => {
    const handle: NativeViewHandle = {
      viewId: () => viewId.current,
      getNativeRef: () => element.current,
      nativeRef: element,
    };
    for (const method of spec?.methods ?? []) {
      handle[method] = (...args: unknown[]) => {
        const id = viewId.current;
        if (id == null) return Promise.reject(Object.assign(new Error(`Unable to find the '${manager}' view with tag -1`), { code: "ERR_ARGUMENT_CAST" }));
        return ardiaNative().callView(manager, id, method, args);
      };
    }
    return handle;
  }, [manager]);

  return { element, rest };
}
