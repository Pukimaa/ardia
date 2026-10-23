import { emitView } from "./core";

type Pager = {
  key: string;
  viewId: number;
  selected: number;
  count: number;
  order: string[] | null;
  sequence: number;
  selectionSequence: number;
  profileId: string | null;
};

const pagers = new Map<string, Pager>();
const keysByView = new Map<number, string>();

type PagerConfig = { key?: unknown; selected?: unknown; count?: unknown; order?: unknown };

export function configurePager(viewId: number, config: unknown) {
  const spec = (config ?? null) as PagerConfig | null;
  const previousKey = keysByView.get(viewId);
  if (!spec || typeof spec.key !== "string") {
    if (previousKey && pagers.get(previousKey)?.viewId === viewId) pagers.delete(previousKey);
    keysByView.delete(viewId);
    return;
  }
  if (previousKey && previousKey !== spec.key && pagers.get(previousKey)?.viewId === viewId) pagers.delete(previousKey);
  keysByView.set(viewId, spec.key);
  const order = typeof spec.order === "string" ? spec.order.split("\n") : null;
  const existing = pagers.get(spec.key);
  const selected = Number(spec.selected) || 0;
  const count = Math.max(1, Number(spec.count) || 1);
  if (existing) {
    existing.viewId = viewId;
    existing.count = count;
    existing.order = order ?? existing.order;
    if (existing.selectionSequence === 0 || selected !== existing.selected) existing.selected = Math.min(selected, count - 1);
    existing.profileId = existing.order?.[existing.selected] ?? null;
    return;
  }
  pagers.set(spec.key, { key: spec.key, viewId, selected: Math.min(selected, count - 1), count, order, sequence: 0, selectionSequence: 0, profileId: order?.[selected] ?? null });
}

export function forgetPagers(viewId: number) {
  const key = keysByView.get(viewId);
  if (key && pagers.get(key)?.viewId === viewId) pagers.delete(key);
  keysByView.delete(viewId);
}

const settle = (pager: Pager, index: number) => {
  pager.selected = Math.max(0, Math.min(pager.count - 1, index));
  pager.profileId = pager.order?.[pager.selected] ?? null;
  pager.sequence++;
  pager.selectionSequence = pager.sequence;
  const base = { sequence: pager.sequence, position: pager.selected, selected: pager.selected, profileId: pager.profileId, velocity: 0 };
  emitView(pager.viewId, "onPagerPosition", { position: pager.selected });
  emitView(pager.viewId, "onPagerState", { ...base, phase: "selected" });
  window.setTimeout(() => emitView(pager.viewId, "onPagerState", { ...base, phase: "settled" }), 16);
  return true;
};

const withOrder = (pager: Pager, order: unknown) => {
  if (typeof order !== "string") return;
  const current = pager.order?.[pager.selected];
  pager.order = order.split("\n");
  if (current) {
    const moved = pager.order.indexOf(current);
    if (moved >= 0) pager.selected = moved;
  }
};

export function switchPager(key: unknown, index: unknown, order: unknown) {
  const pager = pagers.get(String(key));
  if (!pager) return false;
  withOrder(pager, order);
  return settle(pager, Number(index));
}

export function selectPager(key: unknown, profileId: unknown, order: unknown) {
  const pager = pagers.get(String(key));
  if (!pager) return false;
  withOrder(pager, order);
  const index = pager.order?.indexOf(String(profileId)) ?? -1;
  return index >= 0 ? settle(pager, index) : false;
}

export function stepPager(key: unknown, delta: unknown, wrap: unknown, order: unknown) {
  const pager = pagers.get(String(key));
  if (!pager) return false;
  withOrder(pager, order);
  let next = pager.selected + (Number(delta) < 0 ? -1 : 1);
  if (next < 0 || next >= pager.count) {
    if (!wrap) return false;
    next = (next + pager.count) % pager.count;
  }
  return settle(pager, next);
}

export function pagerState(key: unknown) {
  const pager = pagers.get(String(key));
  if (!pager) return null;
  return {
    sequence: pager.sequence,
    selectionSequence: pager.selectionSequence,
    position: pager.selected,
    selected: pager.selected,
    phase: "idle",
    profileId: pager.profileId,
    velocity: 0,
    count: pager.count,
  };
}
