import type { ViewFrame, ViewUpdate } from "../../runtime/bridge";
import { emit, emitView, hostOf, letterIcon, originOf } from "./core";
import { recordVisit } from "./data";
import { startDownload } from "./downloads";
import { listenForKeyEquivalents } from "./keys";
import { requestPermission } from "./permissions";
import { notePointer } from "./ui";
import { windowFor, windowIdOfDocument } from "./windows";

type Entry = { url: string; title: string };

export type MockWebView = {
  viewId: number;
  windowId: string | null;
  props: Record<string, unknown>;
  frame: ViewFrame | null;
  clip: ViewFrame | null;
  visible: boolean;
  order: number;
  element: HTMLIFrameElement | null;
  entries: Entry[];
  index: number;
  loading: boolean;
  progress: number;
  pending: string | null;
  browserId: number;
  tabId: number;
  zoom: number;
  muted: boolean;
  frozen: boolean;
  discarded: boolean;
  themeColor: string | null;
  favicon: string | null;
  sent: string;
  find: { text: string; active: number } | null;
};

export const webViews = new Map<number, MockWebView>();
let nextBrowserId = 1;
let nextTabId = 100;

const LAYER_ATTRIBUTE = "data-ardia-mock-webviews";

const layerFor = (doc: Document): HTMLElement => {
  let layer = doc.querySelector<HTMLElement>(`[${LAYER_ATTRIBUTE}]`);
  if (layer) return layer;
  layer = doc.createElement("div");
  layer.setAttribute(LAYER_ATTRIBUTE, "");
  Object.assign(layer.style, { position: "fixed", left: "0", top: "0", width: "0", height: "0", overflow: "visible", zIndex: "2147483000", pointerEvents: "none" });
  doc.body.appendChild(layer);
  return layer;
};

const current = (view: MockWebView): Entry | null => view.entries[view.index] ?? null;

const isAppPage = (url: string) => /^(chrome|ardia|about):/i.test(url) && !/^about:blank/i.test(url);

const appPageHtml = (url: string) => {
  const host = /^[a-z]+:\/\/([^/?#]*)/i.exec(url)?.[1] ?? url.replace(/^about:/i, "");
  const title = host ? host.charAt(0).toUpperCase() + host.slice(1) : "Page";
  return `<!doctype html><title>${title}</title><body style="font:14px system-ui,sans-serif;padding:32px;color:#555"><h2>${title}</h2><p>${url} (mock engine page)</p></body>`;
};

export const DOWNLOAD_PATTERN = /\.(zip|dmg|pkg|deb|rpm|appimage|tar\.gz|tgz|iso|exe|msi|bin|pdf\?download)$/i;

const readableTitle = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "about:" || parsed.protocol === "data:") return url;
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
};

const sameOriginWindow = (view: MockWebView): Window | null => {
  try {
    const win = view.element?.contentWindow;
    if (!win) return null;
    void win.document.title;
    return win;
  } catch {
    return null;
  }
};

const securityFor = (url: string) => {
  const origin = originOf(url) || null;
  if (url.startsWith("https:"))
    return {
      level: "secure",
      url,
      origin,
      protocol: "TLS 1.3",
      certificate: {
        subject: { commonName: hostOf(url), displayName: hostOf(url), organizations: [], country: "" },
        issuer: { commonName: "Mock Engine CA", displayName: "Mock Engine CA", organizations: ["Ardia"], country: "NL" },
        validFrom: Date.now() - 30 * 864e5,
        validUntil: Date.now() + 60 * 864e5,
        chainLength: 3,
      },
      mixedContent: null,
      isEV: false,
    };
  if (url.startsWith("http:")) {
    const host = hostOf(url);
    const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    return { level: local ? "local" : "insecure", url, origin };
  }
  if (url.startsWith("file:") || /^(chrome|ardia):/.test(url)) return { level: "local", url, origin };
  return { level: "none", url, origin };
};

function emitNavigation(view: MockWebView, force = false) {
  const entry = current(view);
  const url = entry?.url ?? "";
  const navigation = {
    url,
    title: view.loading && !entry?.title ? "" : entry?.title || readableTitle(url),
    canGoBack: view.index > 0,
    canGoForward: view.index < view.entries.length - 1,
    isLoading: view.loading,
    themeColor: view.themeColor,
    themeColorSource: view.themeColor ? "meta" : null,
    initialDocumentAccessed: false,
    committedInitial: view.entries.length > 0 && !(view.entries.length === 1 && url === "about:blank"),
  };
  const key = JSON.stringify(navigation);
  if (!force && key === view.sent) return;
  view.sent = key;
  emitView(view.viewId, "onNavigationChange", navigation);
}

function emitProgress(view: MockWebView, progress: number) {
  if (progress === view.progress) return;
  view.progress = progress;
  emitView(view.viewId, "onProgress", { progress });
}

const placeElement = (view: MockWebView) => {
  const element = view.element;
  if (!element) return;
  const frame = view.frame;
  const shown = view.visible && view.props.visible !== false && !view.discarded && !!frame && frame.width > 0 && frame.height > 0;
  element.style.display = shown ? "block" : "none";
  if (!frame) return;
  Object.assign(element.style, {
    left: `${frame.x}px`,
    top: `${frame.y}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
    zIndex: String(view.order + 1),
  });
  const clip = view.clip;
  if (clip) {
    const top = Math.max(0, clip.y - frame.y);
    const left = Math.max(0, clip.x - frame.x);
    const right = Math.max(0, frame.x + frame.width - (clip.x + clip.width));
    const bottom = Math.max(0, frame.y + frame.height - (clip.y + clip.height));
    element.style.clipPath = top || left || right || bottom ? `inset(${top}px ${right}px ${bottom}px ${left}px)` : "";
  } else element.style.clipPath = "";
  const background = view.props.pageBackgroundColor ?? view.props.contentsBackgroundColor;
  element.style.background = typeof background === "string" ? background : "#fff";
};

const mountElement = (view: MockWebView) => {
  if (view.element) return;
  const win = windowFor(view.windowId) ?? window;
  const doc = win.document;
  const element = doc.createElement("iframe");
  element.dataset.ardiaMockWebview = String(view.viewId);
  element.dataset.browserId = String(view.browserId);
  element.setAttribute("allow", "fullscreen; clipboard-read; clipboard-write; autoplay");
  element.setAttribute("title", "web contents");
  Object.assign(element.style, { position: "fixed", border: "0", margin: "0", padding: "0", pointerEvents: "auto", display: "none", colorScheme: "normal" });
  element.addEventListener("load", () => onFrameLoad(view));
  layerFor(doc).appendChild(element);
  view.element = element;
  placeElement(view);
};

const loadInto = (view: MockWebView, url: string) => {
  mountElement(view);
  const element = view.element!;
  view.pending = url;
  if (isAppPage(url)) {
    element.removeAttribute("src");
    element.srcdoc = appPageHtml(url);
  } else {
    element.removeAttribute("srcdoc");
    element.src = url;
  }
};

export function navigate(view: MockWebView, url: string, mode: "push" | "replace" | "history" = "push") {
  if (!url) return;
  if (DOWNLOAD_PATTERN.test(url.split("?")[0] ?? url) || DOWNLOAD_PATTERN.test(url)) {
    emitView(view.viewId, "onDownloadNavigation", { url, committedUrl: current(view)?.url ?? "", skipped: false });
    startDownload(url, String(view.props.profile ?? ""));
    return;
  }
  if (mode === "push") {
    view.entries = view.entries.slice(0, view.index + 1);
    if (current(view)?.url === "about:blank" && view.entries.length === 1) view.entries = [];
    view.entries.push({ url, title: "" });
    view.index = view.entries.length - 1;
  } else if (mode === "replace") {
    if (view.entries.length === 0) view.entries.push({ url, title: "" });
    else view.entries[view.index] = { url, title: "" };
  }
  view.loading = true;
  view.themeColor = null;
  view.discarded = false;
  view.progress = 0;
  emitNavigation(view);
  emitProgress(view, 0.1);
  window.setTimeout(() => {
    if (view.loading && view.pending === url) emitProgress(view, 0.6);
  }, 30);
  loadInto(view, url);
}

const pageMeta = (view: MockWebView) => {
  const win = sameOriginWindow(view);
  if (!win) return null;
  const doc = win.document;
  const href = view.element?.hasAttribute("srcdoc") ? (current(view)?.url ?? "") : win.location.href;
  const theme = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? null;
  const icon = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href ?? null;
  return { win, doc, href, title: doc.title, theme, icon };
};

function onFrameLoad(view: MockWebView) {
  if (!webViews.has(view.viewId)) return;
  const requested = view.pending;
  view.pending = null;
  const meta = pageMeta(view);
  if (!requested) {
    const href = meta?.href;
    if (!href || href === "about:blank" || href === current(view)?.url) return;
    view.entries = view.entries.slice(0, view.index + 1);
    view.entries.push({ url: href, title: "" });
    view.index = view.entries.length - 1;
  }
  const entry = current(view);
  if (!entry) return;
  if (meta && meta.href && meta.href !== "about:srcdoc" && !/^about:blank/.test(meta.href) && !isAppPage(entry.url)) entry.url = meta.href;
  entry.title = meta?.title ?? "";
  view.themeColor = meta?.theme ?? null;
  view.loading = false;
  emitProgress(view, 1);
  emitNavigation(view);
  const url = entry.url;
  if (/^https?:/.test(url)) {
    const icon = meta?.icon ?? `${originOf(url)}/favicon.ico`;
    view.favicon = icon;
    emitView(view.viewId, "onFavicon", { url: icon, urls: [icon] });
  }
  recordVisit(String(view.props.profile ?? ""), url, entry.title);
  emitView(view.viewId, "onSecurity", securityFor(url));
  emitView(view.viewId, "onZoom", { zoom: view.zoom, host: hostOf(url), isDefault: view.zoom === 1, pinchScale: 1 });
  if (meta) instrumentPage(view, meta.win);
}

const instrumentPage = (view: MockWebView, win: Window) => {
  const doc = win.document;
  const shellWindow = view.element?.ownerDocument.defaultView ?? window;
  listenForKeyEquivalents(doc, () => view.windowId ?? windowIdOfDocument(shellWindow));
  doc.addEventListener(
    "pointerdown",
    (event) => {
      const frame = view.frame;
      const point = frame ? { x: frame.x + event.clientX, y: frame.y + event.clientY } : { x: event.clientX, y: event.clientY };
      notePointer(shellWindow, point);
      emit("ArdiaViews", "onNativePress", { windowId: view.windowId, viewId: view.viewId, ...point });
    },
    true,
  );
  win.addEventListener("focus", () => emitView(view.viewId, "onPageFocus", {}));
  doc.addEventListener("mouseover", (event) => {
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    emitView(view.viewId, "onStatus", { text: link?.href ?? "" });
  });
  doc.addEventListener("mouseout", () => emitView(view.viewId, "onStatus", { text: "" }));
  doc.addEventListener(
    "click",
    (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      const background = event.ctrlKey || event.metaKey || event.button === 1;
      if (link.target !== "_blank" && !background) return;
      event.preventDefault();
      emitView(view.viewId, "onOpenWindow", { url: link.href, disposition: background ? (event.shiftKey ? "foreground" : "background") : "foreground", userGesture: true, postBody: false });
    },
    true,
  );
  doc.addEventListener("auxclick", (event) => {
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || event.button !== 1) return;
    event.preventDefault();
    emitView(view.viewId, "onOpenWindow", { url: link.href, disposition: "background", userGesture: true, postBody: false });
  });
  const pageWindow = win as Window & { open: typeof window.open; Notification?: typeof Notification };
  pageWindow.open = ((url?: string | URL) => {
    const target = url ? new URL(String(url), win.location.href).href : "about:blank";
    emitView(view.viewId, "onOpenWindow", { url: target, disposition: "foreground", userGesture: true, postBody: false });
    return null;
  }) as typeof window.open;
  win.addEventListener("hashchange", () => {
    const entry = current(view);
    if (!entry) return;
    entry.url = win.location.href;
    emitNavigation(view);
  });
  let lastScroll = 0;
  let scrollState = "top";
  win.addEventListener(
    "scroll",
    () => {
      const y = win.scrollY;
      const state = y <= 0 ? "top" : y > lastScroll ? "down" : "up";
      lastScroll = y;
      if (state === scrollState) return;
      scrollState = state;
      emitView(view.viewId, "onPageMessage", { kind: "scroll", data: { state } });
    },
    { passive: true },
  );
  const origin = originOf(current(view)?.url ?? "");
  if (pageWindow.Notification) {
    pageWindow.Notification.requestPermission = (() =>
      requestPermission(view, origin, ["notifications"]).then((result) => (result === "accept" ? "granted" : "denied"))) as typeof Notification.requestPermission;
  }
  const geolocation = win.navigator.geolocation;
  if (geolocation) {
    geolocation.getCurrentPosition = ((success: PositionCallback, failure?: PositionErrorCallback | null) => {
      void requestPermission(view, origin, ["location"]).then((result) => {
        if (result === "accept")
          success({ coords: { latitude: 52.37, longitude: 4.89, accuracy: 20, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) }, timestamp: Date.now(), toJSON: () => ({}) } as GeolocationPosition);
        else failure?.({ code: 1, message: "User denied Geolocation", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      });
    }) as typeof geolocation.getCurrentPosition;
  }
  const media = () => {
    const playing = [...doc.querySelectorAll("video, audio")].some((element) => !(element as HTMLMediaElement).paused);
    emitView(view.viewId, "onMedia", { playing, muted: view.muted });
  };
  doc.addEventListener("play", media, true);
  doc.addEventListener("pause", media, true);
  applyMuted(view);
};

const applyMuted = (view: MockWebView) => {
  const win = sameOriginWindow(view);
  if (!win) return;
  for (const element of win.document.querySelectorAll("video, audio")) (element as HTMLMediaElement).muted = view.muted;
};

export function createWebView(viewId: number, props: Record<string, unknown>) {
  const view: MockWebView = {
    viewId,
    windowId: typeof props.windowId === "string" ? props.windowId : null,
    props: { ...props },
    frame: null,
    clip: null,
    visible: true,
    order: 0,
    element: null,
    entries: [],
    index: -1,
    loading: false,
    progress: 0,
    pending: null,
    browserId: nextBrowserId++,
    tabId: nextTabId++,
    zoom: 1,
    muted: false,
    frozen: false,
    discarded: false,
    themeColor: null,
    favicon: null,
    sent: "",
    find: null,
  };
  webViews.set(viewId, view);
  window.setTimeout(() => {
    if (!webViews.has(viewId)) return;
    mountElement(view);
    emitView(viewId, "onReady", { browserId: view.browserId, tabId: view.tabId });
    const url = typeof props.url === "string" ? props.url : "";
    if (url) navigate(view, url);
    else {
      view.entries = [{ url: "about:blank", title: "" }];
      view.index = 0;
      loadInto(view, "about:blank");
    }
  }, 0);
}

export function updateWebView(viewId: number, update: ViewUpdate) {
  const view = webViews.get(viewId);
  if (!view) return;
  if (update.frame) view.frame = update.frame;
  if (update.clip !== undefined) view.clip = update.clip;
  if (update.visible !== undefined) view.visible = update.visible;
  if (update.order !== undefined) view.order = update.order;
  if (update.props) {
    const previousUrl = view.props.url;
    view.props = { ...view.props, ...update.props };
    if (typeof update.props.url === "string" && update.props.url !== previousUrl && update.props.url !== current(view)?.url) navigate(view, update.props.url);
  }
  placeElement(view);
}

export function destroyWebView(viewId: number) {
  const view = webViews.get(viewId);
  if (!view) return;
  webViews.delete(viewId);
  view.element?.remove();
  view.element = null;
}

const go = (view: MockWebView, offset: number) => {
  const index = view.index + offset;
  if (index < 0 || index >= view.entries.length || offset === 0) return;
  view.index = index;
  navigate(view, view.entries[index]!.url, "history");
};

const findInPage = (view: MockWebView, text: string, forward: boolean, findNext: boolean) => {
  const win = sameOriginWindow(view);
  const body = win?.document.body?.innerText ?? "";
  const lower = body.toLowerCase();
  const needle = text.toLowerCase();
  let count = 0;
  if (needle) for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) count++;
  const previous = view.find?.text === text ? view.find.active : 0;
  const active = count === 0 ? 0 : findNext ? ((previous - 1 + (forward ? 1 : -1) + count) % count) + 1 : 1;
  view.find = { text, active };
  if (count && win) (win as Window & { find?: (text: string, caseSensitive: boolean, backwards: boolean, wrap: boolean) => boolean }).find?.(text, false, !forward, true);
  emitView(view.viewId, "onFindResult", { count, active, final: true });
};

const evaluateIn = (view: MockWebView, code: string): string | null => {
  const win = sameOriginWindow(view) as (Window & { eval?: (code: string) => unknown }) | null;
  if (!win?.eval) return null;
  try {
    const value = win.eval(code);
    return JSON.stringify(value ?? null);
  } catch {
    return null;
  }
};

const capture = (view: MockWebView): { data: string; frame: [number, number, number, number] } | null => {
  const frame = view.frame;
  if (!frame) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(frame.width));
  canvas.height = Math.max(1, Math.round(frame.height));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#888";
  context.font = "14px system-ui";
  context.fillText(current(view)?.title || current(view)?.url || "", 16, 28);
  return { data: canvas.toDataURL("image/png").slice(22), frame: [frame.x, frame.y, frame.width, frame.height] };
};

const view = (viewId: unknown): MockWebView => {
  const found = webViews.get(Number(viewId));
  if (!found) throw Object.assign(new Error(`Unable to find the 'ArdiaCEF' view with tag ${String(viewId)}`), { code: "ERR_ARGUMENT_CAST" });
  return found;
};

export const webViewMethods: Record<string, (viewId: unknown, ...args: unknown[]) => unknown> = {
  loadUrl: (id, url) => navigate(view(id), String(url)),
  goBack: (id) => go(view(id), -1),
  goForward: (id) => go(view(id), 1),
  goToOffset: (id, offset) => go(view(id), Number(offset)),
  reload: (id) => {
    const v = view(id);
    const entry = current(v);
    if (entry) navigate(v, entry.url, "history");
  },
  forceReload: (id) => {
    const v = view(id);
    const entry = current(v);
    if (entry) navigate(v, entry.url, "history");
  },
  stopLoading: (id) => {
    const v = view(id);
    if (!v.loading) return;
    v.loading = false;
    v.pending = null;
    try {
      v.element?.contentWindow?.stop();
    } catch {}
    emitProgress(v, 1);
    emitNavigation(v);
  },
  focus: (id) => {
    const v = view(id);
    try {
      v.element?.focus();
      v.element?.contentWindow?.focus();
    } catch {}
  },
  setMuted: (id, muted) => {
    const v = view(id);
    v.muted = !!muted;
    applyMuted(v);
    emitView(v.viewId, "onMedia", { playing: false, muted: v.muted });
  },
  zoomStep: (id, direction) => {
    const v = view(id);
    const levels = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
    const at = levels.findIndex((level) => level >= v.zoom - 0.001);
    const step = Number(direction);
    v.zoom = step === 0 ? 1 : levels[Math.max(0, Math.min(levels.length - 1, at + (step > 0 ? 1 : -1)))]!;
    const win = sameOriginWindow(v);
    if (win) win.document.documentElement.style.zoom = String(v.zoom);
    const url = current(v)?.url ?? "";
    emitView(v.viewId, "onZoom", { zoom: v.zoom, host: hostOf(url), isDefault: v.zoom === 1, pinchScale: 1 });
  },
  find: (id, text, forward, findNext) => findInPage(view(id), String(text ?? ""), forward !== false, !!findNext),
  stopFinding: (id) => {
    view(id).find = null;
  },
  print: (id) => {
    try {
      view(id).element?.contentWindow?.print();
    } catch {}
  },
  runPageCommand: () => null,
  showDevTools: () => null,
  executeJavaScript: (id, code) => {
    evaluateIn(view(id), String(code));
  },
  evaluate: (id, code) => evaluateIn(view(id), String(code)),
  navigationEntries: (id) => {
    const v = view(id);
    return v.entries.map((entry, index) => ({ url: entry.url, title: entry.title || readableTitle(entry.url), current: index === v.index }));
  },
  capturePicture: (id) => capture(view(id)),
  downloadFavicon: (id, url) => {
    const host = hostOf(String(url)) || hostOf(current(view(id))?.url ?? "");
    return { uri: `data:image/png;base64,${letterIcon(host || "?", 32)}`, width: 32, height: 32 };
  },
  downloadImage: (_id, url) => ({ uri: `data:image/png;base64,${letterIcon(hostOf(String(url)) || "?", 64)}`, width: 64, height: 64 }),
  mediaCommand: (id, action) => {
    const win = sameOriginWindow(view(id));
    const media = win?.document.querySelector("video, audio") as HTMLMediaElement | null;
    if (!media) return;
    if (action === "play") void media.play();
    if (action === "pause" || action === "stop") media.pause();
    if (action === "toggle") void (media.paused ? media.play() : media.pause());
  },
  requestPictureInPicture: () => false,
  exitPictureInPicture: () => null,
  getSecurityInfo: (id) => {
    const url = current(view(id))?.url;
    return url ? securityFor(url) : null;
  },
  openBlockedPopup: () => null,
  clearSiteData: () => ({ cookies: 0, storage: true }),
  resolvePasswordPrompt: () => null,
  resolveAutofillPrompt: () => null,
  executeExtensionAction: () => "none",
  resolveDisplayMedia: () => null,
  mediaCaptureSourceId: () => null,
  notificationAction: () => null,
  resolveUnresponsive: () => null,
  discard: (id) => {
    const v = view(id);
    if (v.discarded) return "already";
    v.discarded = true;
    v.element?.remove();
    v.element = null;
    emitView(v.viewId, "onDiscarded", { url: current(v)?.url ?? "" });
    return "discarded";
  },
  setFrozen: (id, frozen) => {
    view(id).frozen = !!frozen;
  },
};

export function webViewByBrowserId(browserId: number): MockWebView | null {
  for (const candidate of webViews.values()) if (candidate.browserId === browserId) return candidate;
  return null;
}

export function webViewState(viewId: number) {
  const v = webViews.get(viewId);
  if (!v) return null;
  return {
    viewId: v.viewId,
    windowId: v.windowId,
    browserId: v.browserId,
    url: current(v)?.url ?? null,
    title: current(v)?.title ?? null,
    loading: v.loading,
    visible: v.visible && v.props.visible !== false,
    frame: v.frame,
    clip: v.clip,
    entries: v.entries.length,
    index: v.index,
  };
}
