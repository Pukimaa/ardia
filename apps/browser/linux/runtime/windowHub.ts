type WindowAttacher = (win: Window) => void;

type FrameRequest = { win: Window; handle: number; callback: FrameRequestCallback };

declare global {
  interface Window {
    __ardiaEachWindow?: (attach: WindowAttacher) => void;
    __ardiaLiveWindows?: () => Window[];
    __ardiaCurrentWindow?: () => Window;
    __ardiaActiveElement?: () => Element | null;
  }
}

const hostWindow: Window = window;
const liveWindows = new Set<Window>([hostWindow]);
const attachers: WindowAttacher[] = [];
let focusedWindow: Window = hostWindow;

const nativeRequestFrame = hostWindow.requestAnimationFrame.bind(hostWindow);
const nativeCancelFrame = hostWindow.cancelAnimationFrame.bind(hostWindow);
const frameRequests = new Map<number, FrameRequest>();
let nextFrameId = 1;

const isLive = (win: Window) => {
  try {
    return !win.closed && win.document != null;
  } catch {
    return false;
  }
};

export function windows(): Window[] {
  for (const win of liveWindows) if (!isLive(win)) liveWindows.delete(win);
  return [...liveWindows];
}

export function currentWindow(): Window {
  if (focusedWindow !== hostWindow && !isLive(focusedWindow)) focusedWindow = hostWindow;
  return focusedWindow;
}

export function activeElement(): Element | null {
  const current = currentWindow();
  if (current.document.hasFocus()) return current.document.activeElement;
  for (const win of windows()) if (win.document.hasFocus()) return win.document.activeElement;
  return current.document.activeElement;
}

export function eachWindow(attach: WindowAttacher) {
  attachers.push(attach);
  for (const win of windows()) attach(win);
}

const isVisible = (win: Window) => isLive(win) && win.document.visibilityState === "visible";

const frameWindow = () => {
  const current = currentWindow();
  if (current !== hostWindow && isVisible(current)) return current;
  for (const win of liveWindows) if (win !== hostWindow && isVisible(win)) return win;
  return hostWindow;
};

const scheduleFrame = (id: number, callback: FrameRequestCallback, win: Window) => {
  const offset = win === hostWindow ? 0 : win.performance.timeOrigin - hostWindow.performance.timeOrigin;
  const request = win === hostWindow ? nativeRequestFrame : win.requestAnimationFrame.bind(win);
  const handle = request((time) => {
    frameRequests.delete(id);
    callback(time + offset);
  });
  frameRequests.set(id, { win, handle, callback });
};

function requestFrame(callback: FrameRequestCallback): number {
  const id = nextFrameId++;
  scheduleFrame(id, callback, frameWindow());
  return id;
}

function cancelFrame(id: number) {
  const request = frameRequests.get(id);
  if (!request) return;
  frameRequests.delete(id);
  if (request.win === hostWindow) nativeCancelFrame(request.handle);
  else if (isLive(request.win)) request.win.cancelAnimationFrame(request.handle);
}

const rescheduleFramesOf = (win: Window) => {
  for (const [id, request] of [...frameRequests]) {
    if (request.win !== win) continue;
    frameRequests.delete(id);
    scheduleFrame(id, request.callback, hostWindow);
  }
};

export function adoptWindow(win: Window) {
  if (liveWindows.has(win)) return;
  liveWindows.add(win);
  const markFocused = () => {
    focusedWindow = win;
  };
  win.addEventListener("focus", markFocused, true);
  win.document.addEventListener("focusin", markFocused, true);
  win.document.addEventListener("pointerdown", markFocused, true);
  win.addEventListener("pagehide", () => releaseWindow(win));
  if (win.document.hasFocus()) focusedWindow = win;
  for (const attach of attachers) attach(win);
}

export function releaseWindow(win: Window) {
  if (!liveWindows.delete(win) || win === hostWindow) return;
  if (focusedWindow === win) focusedWindow = hostWindow;
  rescheduleFramesOf(win);
}

hostWindow.addEventListener("focus", () => {
  focusedWindow = hostWindow;
});

hostWindow.__ardiaEachWindow = eachWindow;
hostWindow.__ardiaLiveWindows = windows;
hostWindow.__ardiaCurrentWindow = currentWindow;
hostWindow.__ardiaActiveElement = activeElement;
hostWindow.requestAnimationFrame = requestFrame;
hostWindow.cancelAnimationFrame = cancelFrame;
