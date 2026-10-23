import { AppRegistry } from "react-native-web";
import { adoptWindow, releaseWindow } from "./windowHub";

type MountedRoot = { unmount(): void };

type WindowDocument = { windowId: string; win: Window; root: MountedRoot | null };

declare global {
  interface Window {
    __ardiaNativeOpenWindowDocument?: (windowId: string) => boolean;
    __ardiaWindowDocumentReady?: (win: Window) => void;
    __ardiaWindowDocuments?: () => string[];
  }
}

export const WINDOW_NAME_PREFIX = "ardia-window-";
const READY_TIMEOUT_MS = 15000;

const documents = new Map<string, WindowDocument>();

export const windowDocumentUrl = (windowId: string) => `window.html#${encodeURIComponent(windowId)}`;

const isOpen = (win: Window) => {
  try {
    return !win.closed;
  } catch {
    return false;
  }
};

const rootOf = (win: Window): HTMLElement | null => {
  try {
    if (!win.location.pathname.endsWith("/window.html")) return null;
    if (win.document.readyState === "loading") return null;
    return win.document.getElementById("root");
  } catch {
    return null;
  }
};

const unmount = (entry: WindowDocument) => {
  const root = entry.root;
  entry.root = null;
  if (documents.get(entry.windowId) === entry) documents.delete(entry.windowId);
  releaseWindow(entry.win);
  try {
    root?.unmount();
  } catch (error) {
    console.error(error);
  }
};

const mount = (entry: WindowDocument) => {
  if (entry.root || !isOpen(entry.win)) return;
  const rootTag = rootOf(entry.win);
  if (!rootTag) return;
  adoptWindow(entry.win);
  entry.win.addEventListener("pagehide", () => unmount(entry), { once: true });
  entry.root = AppRegistry.runApplication("main", { rootTag, initialProps: { windowId: entry.windowId } }) as MountedRoot;
};

const awaitDocument = (entry: WindowDocument) => {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const poll = () => {
    if (entry.root || documents.get(entry.windowId) !== entry) return;
    if (!isOpen(entry.win)) {
      documents.delete(entry.windowId);
      return;
    }
    mount(entry);
    if (entry.root) return;
    if (Date.now() > deadline) {
      console.error(`Window document for ${entry.windowId} never loaded`);
      return;
    }
    setTimeout(poll, 8);
  };
  poll();
};

export function openWindowDocument(windowId: string): boolean {
  const existing = documents.get(windowId);
  if (existing && isOpen(existing.win)) {
    if (!existing.root) awaitDocument(existing);
    return true;
  }
  const win = window.open(windowDocumentUrl(windowId), `${WINDOW_NAME_PREFIX}${windowId}`);
  if (!win) {
    console.error(`The engine refused the window document for ${windowId}`);
    return false;
  }
  const entry: WindowDocument = { windowId, win, root: null };
  documents.set(windowId, entry);
  awaitDocument(entry);
  return true;
}

export function windowDocumentIds(): string[] {
  return [...documents.values()].filter((entry) => entry.root && isOpen(entry.win)).map((entry) => entry.windowId);
}

export function installWindowDocuments() {
  window.__ardiaNativeOpenWindowDocument = openWindowDocument;
  window.__ardiaWindowDocuments = windowDocumentIds;
  window.__ardiaWindowDocumentReady = (win) => {
    for (const entry of documents.values()) if (entry.win === win) mount(entry);
  };
}
