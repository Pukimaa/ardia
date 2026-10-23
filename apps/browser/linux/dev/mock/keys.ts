import { emit } from "./core";
import { closeWindow, focusedWindowId, onWindowAttached, windows } from "./windows";

type Binding = { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; command: string; arg?: string; native?: "closeWindow" | "quit" };

export const KEY_BINDINGS: Binding[] = [
  { key: "t", ctrl: true, command: "newTab" },
  { key: "t", ctrl: true, shift: true, command: "reopenClosedTab" },
  { key: "t", ctrl: true, alt: true, command: "newTabInGroup" },
  { key: "n", ctrl: true, command: "newWindow" },
  { key: "n", ctrl: true, shift: true, command: "newIncognitoWindow" },
  { key: "n", ctrl: true, alt: true, command: "newLittleArdia" },
  { key: "o", ctrl: true, command: "openFile" },
  { key: "l", ctrl: true, command: "focusCommandBar" },
  { key: "F6", command: "focusCommandBar" },
  { key: "w", ctrl: true, command: "closeTab" },
  { key: "F4", ctrl: true, command: "closeTab" },
  { key: "w", ctrl: true, shift: true, command: "closeWindow", native: "closeWindow" },
  { key: "q", ctrl: true, command: "quit", native: "quit" },
  { key: "k", ctrl: true, shift: true, command: "closeAllTabs" },
  { key: "k", ctrl: true, alt: true, command: "cleanUpTabs" },
  { key: ",", ctrl: true, command: "openSettings" },
  { key: "p", ctrl: true, command: "print" },
  { key: "c", ctrl: true, shift: true, command: "copyUrl" },
  { key: "f", ctrl: true, command: "findInPage" },
  { key: "g", ctrl: true, command: "findNext" },
  { key: "g", ctrl: true, shift: true, command: "findPrevious" },
  { key: "e", ctrl: true, command: "useSelectionForFind" },
  { key: ".", ctrl: true, command: "stop" },
  { key: "r", ctrl: true, command: "reload" },
  { key: "F5", command: "reload" },
  { key: "r", ctrl: true, shift: true, command: "forceReload" },
  { key: "s", ctrl: true, shift: true, command: "toggleTabLayout" },
  { key: "s", ctrl: true, command: "toggleSidebar" },
  { key: "b", ctrl: true, shift: true, command: "toggleBookmarksBar" },
  { key: "b", ctrl: true, alt: true, command: "manageBookmarks" },
  { key: "0", ctrl: true, command: "zoomReset" },
  { key: "=", ctrl: true, command: "zoomIn" },
  { key: "+", ctrl: true, command: "zoomIn" },
  { key: "-", ctrl: true, command: "zoomOut" },
  { key: "u", ctrl: true, command: "viewSource" },
  { key: "i", ctrl: true, shift: true, command: "devTools" },
  { key: "j", ctrl: true, alt: true, command: "javaScriptConsole" },
  { key: "F12", command: "toggleDevTools" },
  { key: "F7", command: "caretBrowsing" },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ key: String(n), ctrl: true, command: "selectTab", arg: String(n) })),
  { key: "9", ctrl: true, command: "selectLastTab" },
  { key: "ArrowLeft", alt: true, command: "back" },
  { key: "ArrowRight", alt: true, command: "forward" },
  { key: "[", ctrl: true, command: "back" },
  { key: "]", ctrl: true, command: "forward" },
  { key: "Tab", ctrl: true, command: "nextTab" },
  { key: "Tab", ctrl: true, shift: true, command: "previousTab" },
  { key: "PageDown", ctrl: true, command: "nextTab" },
  { key: "PageUp", ctrl: true, command: "previousTab" },
  { key: "PageDown", ctrl: true, shift: true, command: "moveTabDown" },
  { key: "PageUp", ctrl: true, shift: true, command: "moveTabUp" },
  { key: "a", ctrl: true, shift: true, command: "searchTabs" },
  { key: "d", ctrl: true, command: "bookmarkPage" },
  { key: "d", ctrl: true, shift: true, command: "bookmarkAllTabs" },
  { key: "d", ctrl: true, alt: true, shift: true, command: "togglePinnedRow" },
  { key: "j", ctrl: true, shift: true, command: "downloads" },
  { key: "h", ctrl: true, command: "showHistory" },
  { key: "y", ctrl: true, command: "showHistory" },
  { key: "m", ctrl: true, shift: true, command: "openProfileMenu" },
  { key: "Delete", ctrl: true, shift: true, command: "clearBrowsingData" },
];

const normalized = (key: string) => (key.length === 1 ? key.toLowerCase() : key);

export function bindingFor(event: { key: string; code?: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): Binding | null {
  if (event.metaKey) return null;
  const digit = /^Digit(\d)$/.exec(event.code ?? "")?.[1];
  const keys = new Set([normalized(event.key), ...(digit ? [digit] : [])]);
  if (event.key === "_" ) keys.add("-");
  if (event.key === "{") keys.add("[");
  if (event.key === "}") keys.add("]");
  for (const binding of KEY_BINDINGS) {
    if (!keys.has(binding.key)) continue;
    if (!!binding.ctrl !== event.ctrlKey || !!binding.alt !== event.altKey) continue;
    const wantsShift = !!binding.shift;
    if (wantsShift !== event.shiftKey && !(binding.key === "+" && event.shiftKey)) continue;
    return binding;
  }
  return null;
}

export const commandLog: { command: string; arg: string | null; windowId: string | null }[] = [];

let focusGeneration = 0;

export function sendCommand(command: string, arg: string | null, windowId: string | null) {
  commandLog.push({ command, arg, windowId });
  emit("ArdiaShell", "onCommand", { command, arg, windowId, focusGeneration: ++focusGeneration });
}

export function runBinding(binding: Binding, windowId: string | null) {
  if (binding.native === "closeWindow") {
    if (!windowId) return;
    const kind = windows.get(windowId)?.options.kind;
    if (kind && kind !== "browser") closeWindow(windowId);
    else emit("ArdiaShell", "onWindowEvent", { type: "closeRequest", id: windowId });
    return;
  }
  if (binding.native === "quit") {
    emit("ArdiaShell", "onAppEvent", { type: "willQuit" });
    return;
  }
  sendCommand(binding.command, binding.arg ?? null, windowId);
}

export function handleKeyEquivalent(event: KeyboardEvent, windowId: string | null): boolean {
  const binding = bindingFor(event);
  if (!binding) return false;
  event.preventDefault();
  event.stopPropagation();
  runBinding(binding, windowId ?? focusedWindowId());
  return true;
}

const listening = new WeakSet<Document>();

export function listenForKeyEquivalents(doc: Document, windowId: () => string | null) {
  if (listening.has(doc)) return;
  listening.add(doc);
  doc.addEventListener("keydown", (event) => handleKeyEquivalent(event, windowId()), true);
}

onWindowAttached((record, win) => listenForKeyEquivalents(win.document, () => record.id));

export function quitApp() {
  emit("ArdiaShell", "onAppEvent", { type: "willQuit" });
}

export function closeAllWindows() {
  for (const id of [...windows.keys()]) closeWindow(id);
}
