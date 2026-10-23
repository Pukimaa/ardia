import type { ViewUpdate } from "../../runtime/bridge";
import { windows } from "./windows";

export type MockView = { manager: string; props: Record<string, unknown>; update: ViewUpdate; windowId: string | null };

export const views = new Map<number, MockView>();

export function swipeLocation(viewId: number) {
  const view = views.get(viewId);
  const frame = view?.update.frame;
  if (!view || !frame) return null;
  return { ...frame, windowNumber: (view.windowId && windows.get(view.windowId)?.number) || 0 };
}
