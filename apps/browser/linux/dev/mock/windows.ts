import { emit, options } from "./core";
import { closeActiveMenu, trackPointer } from "./ui";

export type WindowOptions = {
  frame?: [number, number, number, number] | null;
  incognito?: boolean;
  title?: string;
  focus?: boolean;
  kind?: "browser" | "small" | "settings" | "import";
  profile?: string;
  size?: [number, number];
  behind?: string;
  chromeWindow?: string;
};

export type MockWindow = {
  id: string;
  number: number;
  options: WindowOptions;
  title: string;
  win: Window | null;
  opened: boolean;
  blocked: boolean;
  closing: boolean;
  lightsCenter: [number, number] | null;
  leftEdge: boolean;
};

const WINDOW_NAME_PREFIX = "ardia-window-";

export const windows = new Map<string, MockWindow>();
let nextWindowNumber = 1001;
let focusedId: string | null = null;
const attachedWindows = new WeakSet<Window>();
const windowAttachers: ((record: MockWindow, win: Window) => void)[] = [];

export function onWindowAttached(attach: (record: MockWindow, win: Window) => void) {
  windowAttachers.push(attach);
}

const runtime = window as Window & { __ardiaLiveWindows?: () => Window[]; __ardiaNativeOpenWindowDocument?: (windowId: string) => boolean };

const liveWindows = (): Window[] => runtime.__ardiaLiveWindows?.() ?? [];

const findDocument = (id: string): Window | null => {
  for (const win of liveWindows()) {
    try {
      if (win !== window && win.name === `${WINDOW_NAME_PREFIX}${id}` && !win.closed) return win;
    } catch {}
  }
  return null;
};

export function windowFor(id: string | null | undefined): Window | null {
  if (!id) return null;
  const record = windows.get(id);
  if (record?.win && !record.win.closed) return record.win;
  return findDocument(id);
}

export function focusedWindowId(): string | null {
  if (focusedId && windows.get(focusedId)?.win && !windows.get(focusedId)?.win?.closed) return focusedId;
  for (const record of windows.values()) if (record.win && !record.win.closed) return record.id;
  return null;
}

export function focusedDocumentWindow(): Window {
  return windowFor(focusedWindowId()) ?? window;
}

export function windowIdOfDocument(win: Window): string | null {
  for (const record of windows.values()) if (record.win === win) return record.id;
  try {
    if (win.name.startsWith(WINDOW_NAME_PREFIX)) return win.name.slice(WINDOW_NAME_PREFIX.length);
  } catch {}
  return null;
}

const frameOf = (win: Window): [number, number, number, number] => [win.screenX, win.screenY, win.outerWidth || win.innerWidth, win.outerHeight || win.innerHeight];

const markFocused = (record: MockWindow) => {
  if (focusedId === record.id) return;
  focusedId = record.id;
  emit("ArdiaShell", "onWindowEvent", { type: "focus", id: record.id });
  renderHostPanel();
};

const noteClosed = (record: MockWindow) => {
  if (!windows.has(record.id)) return;
  windows.delete(record.id);
  if (focusedId === record.id) focusedId = null;
  emit("ArdiaShell", "onWindowEvent", { type: "close", id: record.id });
  renderHostPanel();
  const next = focusedWindowId();
  if (next) markFocused(windows.get(next)!);
};

const attach = (record: MockWindow, win: Window) => {
  record.win = win;
  record.opened = true;
  if (attachedWindows.has(win)) return;
  attachedWindows.add(win);
  try {
    win.document.title = record.title || "Ardia";
    if (record.options.incognito) win.document.documentElement.dataset.ardiaIncognito = "";
  } catch {}
  trackPointer(win);
  win.addEventListener("focus", () => markFocused(record));
  win.document.addEventListener("pointerdown", () => markFocused(record), true);
  win.document.addEventListener("focusin", () => markFocused(record), true);
  let frameTimer = 0;
  win.addEventListener("resize", () => {
    window.clearTimeout(frameTimer);
    frameTimer = window.setTimeout(() => {
      if (!win.closed) emit("ArdiaShell", "onWindowEvent", { type: "frame", id: record.id, frame: frameOf(win) });
    }, 60);
  });
  win.addEventListener("pagehide", () => {
    closeActiveMenu();
    window.setTimeout(() => {
      if (win.closed || record.closing) noteClosed(record);
      else if (record.win === win) {
        record.win = null;
        record.opened = false;
        void waitForDocument(record);
      }
    }, 40);
  });
  for (const attachWindow of windowAttachers) attachWindow(record, win);
  if (record.options.focus !== false || !focusedId) {
    try {
      win.focus();
    } catch {}
    markFocused(record);
  }
  emit("ArdiaShell", "onWindowEvent", { type: "frame", id: record.id, frame: frameOf(win) });
  renderHostPanel();
};

const waitForDocument = async (record: MockWindow) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && windows.get(record.id) === record) {
    const win = findDocument(record.id);
    if (win) {
      try {
        if (win.document.readyState !== "loading" && win.document.getElementById("root")) return attach(record, win);
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
};

const closedPoll = () => {
  for (const record of [...windows.values()]) if (record.win && record.win.closed) noteClosed(record);
};
window.setInterval(closedPoll, 250);

export function requestWindowDocument(record: MockWindow) {
  const open = runtime.__ardiaNativeOpenWindowDocument;
  if (!open) {
    window.setTimeout(() => requestWindowDocument(record), 20);
    return;
  }
  record.blocked = !open(record.id);
  renderHostPanel();
  if (!record.blocked) void waitForDocument(record);
}

export function openWindow(id: string, windowOptions: WindowOptions = {}) {
  const existing = windows.get(id);
  if (existing) {
    existing.options = { ...existing.options, ...windowOptions };
    if (existing.win && !existing.win.closed) {
      if (windowOptions.focus !== false) focusWindow(id);
      return;
    }
    requestWindowDocument(existing);
    return;
  }
  const record: MockWindow = {
    id,
    number: nextWindowNumber++,
    options: windowOptions,
    title: windowOptions.title ?? "Ardia",
    win: null,
    opened: false,
    blocked: false,
    closing: false,
    lightsCenter: null,
    leftEdge: false,
  };
  windows.set(id, record);
  requestWindowDocument(record);
}

export function closeWindow(id: string) {
  const record = windows.get(id);
  if (!record) return;
  record.closing = true;
  const win = windowFor(id);
  if (win) {
    try {
      win.close();
    } catch {}
  }
  window.setTimeout(() => noteClosed(record), win ? 30 : 0);
}

export function focusWindow(id: string) {
  const record = windows.get(id);
  const win = windowFor(id);
  if (!record || !win) return;
  try {
    win.focus();
  } catch {}
  markFocused(record);
}

export function setWindowTitle(id: string, title: string) {
  const record = windows.get(id);
  if (!record) return;
  record.title = title;
  try {
    if (record.win) record.win.document.title = title;
  } catch {}
  renderHostPanel();
}

export function windowFrame(id: string): [number, number, number, number] | null {
  const win = windowFor(id);
  return win ? frameOf(win) : null;
}

export function openWindowIds(): string[] {
  return [...windows.values()].filter((record) => record.win && !record.win.closed).map((record) => record.id);
}

type Appearance = "auto" | "light" | "dark";

let appearance = "auto" as Appearance;
const systemQuery = window.matchMedia("(prefers-color-scheme: dark)");
const systemDark = () => options.dark ?? systemQuery.matches;
let effectiveDark = appearance === "dark" || (appearance === "auto" && systemDark());

type FakeListener = (event: MediaQueryListEvent) => void;

const darkQueries = new Set<{ list: MediaQueryList; listeners: Set<FakeListener>; wantsDark: boolean }>();

const realMatchMedia = window.matchMedia.bind(window);

const fakeQuery = (query: string): MediaQueryList | null => {
  const scheme = /prefers-color-scheme\s*:\s*(dark|light)/i.exec(query)?.[1]?.toLowerCase();
  if (!scheme || !/^\s*\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)\s*$/i.test(query)) return null;
  const wantsDark = scheme === "dark";
  const listeners = new Set<FakeListener>();
  const list = {
    media: query,
    get matches() {
      return effectiveDark === wantsDark;
    },
    onchange: null as ((event: MediaQueryListEvent) => void) | null,
    addListener: (listener: FakeListener) => listeners.add(listener),
    removeListener: (listener: FakeListener) => listeners.delete(listener),
    addEventListener: (_type: string, listener: FakeListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: FakeListener) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  darkQueries.add({ list, listeners, wantsDark });
  return list;
};

window.matchMedia = (query: string) => fakeQuery(query) ?? realMatchMedia(query);

const applySchemeTo = (win: Window) => {
  try {
    win.document.documentElement.style.colorScheme = effectiveDark ? "dark" : "light";
  } catch {}
};

const refreshAppearance = () => {
  const dark = appearance === "dark" || (appearance === "auto" && systemDark());
  if (dark === effectiveDark) return;
  effectiveDark = dark;
  for (const record of windows.values()) if (record.win) applySchemeTo(record.win);
  applySchemeTo(window);
  for (const { list, listeners, wantsDark } of darkQueries) {
    const event = { matches: effectiveDark === wantsDark, media: list.media } as MediaQueryListEvent;
    for (const listener of [...listeners]) listener(event);
    (list.onchange as FakeListener | null)?.(event);
  }
  emit("ArdiaShell", "onAppEvent", { type: "appearance", dark: effectiveDark });
};

systemQuery.addEventListener("change", refreshAppearance);
onWindowAttached((_record, win) => applySchemeTo(win));
applySchemeTo(window);

export function setAppearance(mode: Appearance) {
  appearance = mode === "light" || mode === "dark" ? mode : "auto";
  refreshAppearance();
}

export const isDark = () => effectiveDark;

export function setSystemDark(dark: boolean | null) {
  options.dark = dark ?? undefined;
  refreshAppearance();
}

let hostPanel: HTMLElement | null = null;

export function renderHostPanel() {
  if (!document.body) return;
  if (!hostPanel) {
    hostPanel = document.createElement("div");
    hostPanel.dataset.ardiaMockHost = "";
    Object.assign(hostPanel.style, { font: "13px system-ui, sans-serif", padding: "16px", color: "#333", maxWidth: "560px" });
    document.body.appendChild(hostPanel);
  }
  hostPanel.textContent = "";
  const heading = document.createElement("h3");
  heading.textContent = "Ardia mock engine: host page";
  heading.style.margin = "0 0 8px";
  hostPanel.appendChild(heading);
  const note = document.createElement("p");
  note.textContent = "This page holds the app's one JS realm. Each Ardia window is a popup of it; allow popups for this site if none open.";
  note.style.margin = "0 0 12px";
  hostPanel.appendChild(note);
  for (const record of windows.values()) {
    const row = document.createElement("div");
    row.dataset.windowId = record.id;
    row.style.margin = "4px 0";
    const state = record.win && !record.win.closed ? (focusedId === record.id ? "focused" : "open") : record.blocked ? "blocked" : "opening";
    row.textContent = `${record.title || "Ardia"} (${record.id}, ${state}) `;
    const button = document.createElement("button");
    button.textContent = record.win && !record.win.closed ? "Focus" : "Open";
    button.addEventListener("click", () => {
      if (record.win && !record.win.closed) focusWindow(record.id);
      else requestWindowDocument(record);
    });
    row.appendChild(button);
    hostPanel.appendChild(row);
  }
  const reopen = document.createElement("button");
  reopen.textContent = "Reopen (dock click)";
  reopen.style.marginTop = "8px";
  reopen.addEventListener("click", () => emit("ArdiaShell", "onAppEvent", { type: "reopen" }));
  hostPanel.appendChild(reopen);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderHostPanel);
else renderHostPanel();
