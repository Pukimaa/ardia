import { documents, emit, hostOf, letterIcon, now } from "./core";

type HistoryRow = { u: string; t: string; n: number; v: number[] };
type Bookmark = { id: string; k: "u" | "f"; t: string; u?: string; a: number; key?: string; c?: Bookmark[] };

type ProfileData = {
  history: Map<string, HistoryRow>;
  bookmarks: { bar: Bookmark; other: Bookmark };
  favicons: Map<string, { icon: string; png: string }>;
  passwords: { origin: string; username: string; password: string; created: number; modified: number }[];
  neverSave: Set<string>;
  passwordAutofill: boolean;
  autofill: { addresses: boolean; cards: boolean };
  addresses: Record<string, unknown>[];
  cards: (Record<string, unknown> & { number?: string })[];
  zoom: Record<string, number>;
  externalApps: { origin: string; scheme: string; app: string | null; icon: string | null }[];
};

const STORE = "mock-engine-profiles.json";

const profiles = new Map<string, ProfileData>();

const emptyProfile = (): ProfileData => ({
  history: new Map(),
  bookmarks: {
    bar: { id: "bar", k: "f", t: "Bookmarks Bar", a: now(), c: [] },
    other: { id: "other", k: "f", t: "Other Bookmarks", a: now(), c: [] },
  },
  favicons: new Map(),
  passwords: [],
  neverSave: new Set(),
  passwordAutofill: true,
  autofill: { addresses: true, cards: true },
  addresses: [],
  cards: [],
  zoom: {},
  externalApps: [],
});

const restore = () => {
  try {
    const saved = JSON.parse(documents.get(STORE) ?? "{}") as Record<string, { history?: HistoryRow[]; bookmarks?: ProfileData["bookmarks"]; passwords?: ProfileData["passwords"]; zoom?: Record<string, number> }>;
    for (const [name, data] of Object.entries(saved)) {
      const profile = emptyProfile();
      for (const row of data.history ?? []) profile.history.set(row.u, row);
      if (data.bookmarks) profile.bookmarks = data.bookmarks;
      profile.passwords = data.passwords ?? [];
      profile.zoom = data.zoom ?? {};
      profiles.set(name, profile);
    }
  } catch {}
};
restore();

let saveTimer = 0;
const save = () => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const out: Record<string, unknown> = {};
    for (const [name, profile] of profiles)
      out[name] = { history: [...profile.history.values()].slice(-2000), bookmarks: profile.bookmarks, passwords: profile.passwords, zoom: profile.zoom };
    documents.set(STORE, JSON.stringify(out));
  }, 200);
};

export function profile(name: unknown): ProfileData {
  const key = String(name ?? "");
  let data = profiles.get(key);
  if (!data) profiles.set(key, (data = emptyProfile()));
  return data;
}

const watched = { history: new Set<string>(), bookmarks: new Set<string>() };

const engineEvent = (topic: string, payload: Record<string, unknown>) => emit("ArdiaCEF", "onEngineEvent", { topic, payload: JSON.stringify(payload) });

export function recordVisit(profileName: string, url: string, title: string) {
  if (!/^https?:/.test(url)) return;
  const data = profile(profileName);
  const row = data.history.get(url) ?? { u: url, t: title, n: 0, v: [] };
  row.t = title || row.t;
  row.n += 1;
  row.v = [...row.v, now()].slice(-50);
  data.history.delete(url);
  data.history.set(url, row);
  save();
  if (watched.history.has(profileName)) engineEvent("history.changed", { profile: profileName, kind: "visit", u: url, t: row.t, n: row.n, at: now() });
}

const walk = (node: Bookmark, visit: (node: Bookmark, parent: Bookmark | null) => void, parent: Bookmark | null = null) => {
  visit(node, parent);
  for (const child of node.c ?? []) walk(child, visit, node);
};

const findBookmark = (data: ProfileData, id: string) => {
  let found: { node: Bookmark; parent: Bookmark | null } | null = null;
  for (const root of [data.bookmarks.bar, data.bookmarks.other]) walk(root, (node, parent) => {
    if (node.id === id) found = { node, parent };
  });
  return found as { node: Bookmark; parent: Bookmark | null } | null;
};

const applyBookmarks = (profileName: string, ops: Record<string, unknown>[]) => {
  const data = profile(profileName);
  let applied = 0;
  let skipped = 0;
  const invalid: string[] = [];
  for (const op of ops) {
    const id = String(op.id ?? "");
    const parentId = String(op.parent ?? "");
    if (op.op === "add") {
      if (findBookmark(data, id)) {
        if (op.ifAbsent) skipped++;
        else invalid.push(id);
        continue;
      }
      const parent = parentId === "bar" ? data.bookmarks.bar : parentId === "other" ? data.bookmarks.other : findBookmark(data, parentId)?.node;
      if (!parent || parent.k !== "f") {
        invalid.push(id);
        continue;
      }
      const node: Bookmark = { id, k: op.k === "f" ? "f" : "u", t: String(op.t ?? ""), a: Number(op.a) || now(), ...(op.k === "f" ? { c: [] } : { u: String(op.u ?? "") }), ...(op.key ? { key: String(op.key) } : {}) };
      const children = (parent.c ??= []);
      const index = typeof op.index === "number" ? Math.max(0, Math.min(children.length, op.index)) : children.length;
      children.splice(index, 0, node);
      applied++;
    } else if (op.op === "move") {
      const found = findBookmark(data, id);
      const parent = parentId === "bar" ? data.bookmarks.bar : parentId === "other" ? data.bookmarks.other : findBookmark(data, parentId)?.node;
      if (!found?.parent || !parent?.c) {
        invalid.push(id);
        continue;
      }
      found.parent.c = found.parent.c!.filter((child) => child !== found.node);
      parent.c.splice(Math.max(0, Math.min(parent.c.length, Number(op.index) || 0)), 0, found.node);
      applied++;
    } else if (op.op === "update") {
      const found = findBookmark(data, id);
      if (!found) {
        invalid.push(id);
        continue;
      }
      if (typeof op.t === "string") found.node.t = op.t;
      if (typeof op.u === "string" && found.node.k === "u") found.node.u = op.u;
      applied++;
    } else if (op.op === "remove") {
      const found = findBookmark(data, id);
      if (!found?.parent) {
        skipped++;
        continue;
      }
      found.parent.c = found.parent.c!.filter((child) => child !== found.node);
      applied++;
    } else invalid.push(id);
  }
  save();
  if (applied && watched.bookmarks.has(profileName)) window.setTimeout(() => engineEvent("bookmarks.changed", { profile: profileName }), 0);
  return { applied, skipped, invalid };
};

let batterySaver: "on" | "off" | "default" = "default";
let cliControl = { state: "off" as "off" | "starting" | "on" | "external", port: undefined as number | undefined, connections: 0, generation: 0 };

export const engineCalls: Record<string, (profileName: string, args: Record<string, unknown>) => unknown> = {
  ac_history_query: (name, args) => {
    const max = Number(args.maxUrls) || 5000;
    const maxVisits = Number(args.maxVisits) || 50;
    const rows = [...profile(name).history.values()].reverse().slice(0, max);
    return { entries: rows.map((row) => ({ ...row, v: row.v.slice(-maxVisits) })) };
  },
  ac_history_add: (name, args) => {
    const data = profile(name);
    let added = 0;
    for (const page of (args.pages as { u: string; t: string; v: number[] }[]) ?? []) {
      const row = data.history.get(page.u) ?? { u: page.u, t: page.t, n: 0, v: [] };
      const fresh = page.v.filter((at) => !row.v.some((seen) => Math.abs(seen - at) <= (Number(args.toleranceMs) || 1000)));
      row.v = [...row.v, ...fresh].sort((a, b) => a - b).slice(-50);
      row.n += fresh.length;
      row.t = page.t || row.t;
      data.history.set(page.u, row);
      added += fresh.length;
    }
    save();
    return { added };
  },
  ac_history_import: (name, args) => {
    const data = profile(name);
    let imported = 0;
    for (const row of (args.rows as { u: string; t: string; n: number; l: number }[]) ?? []) {
      if (data.history.has(row.u)) continue;
      data.history.set(row.u, { u: row.u, t: row.t, n: row.n, v: [row.l] });
      imported++;
    }
    save();
    return { imported };
  },
  ac_history_delete_urls: (name, args) => {
    const data = profile(name);
    const urls = (args.urls as string[]) ?? [];
    for (const url of urls) data.history.delete(url);
    save();
    if (watched.history.has(name)) engineEvent("history.changed", { profile: name, kind: "deleted", all: false, urls });
    return { deleted: urls.length };
  },
  ac_history_watch: (name) => {
    watched.history.add(name);
    return { ok: true };
  },
  ac_bookmarks_tree: (name) => profile(name).bookmarks,
  ac_bookmarks_apply: (name, args) => applyBookmarks(name, (args.ops as Record<string, unknown>[]) ?? []),
  ac_bookmarks_watch: (name) => {
    watched.bookmarks.add(name);
    return { ok: true };
  },
  ac_favicons_get: (name, args) => {
    const data = profile(name);
    const size = Number(args.size) || 32;
    const pages: Record<string, { png: string; icon: string }> = {};
    for (const page of (args.pages as string[]) ?? []) {
      const saved = data.favicons.get(page);
      if (saved) pages[page] = saved;
      else if (/^https?:/.test(page) && data.history.has(page)) pages[page] = { icon: `${new URL(page).origin}/favicon.ico`, png: letterIcon(hostOf(page), size) };
    }
    const icons: Record<string, { png: string }> = {};
    for (const icon of (args.icons as string[]) ?? []) icons[icon] = { png: letterIcon(hostOf(icon) || icon, size) };
    return { pages, icons };
  },
  ac_favicons_set: (name, args) => {
    profile(name).favicons.set(String(args.page), { icon: String(args.icon), png: String(args.png) });
    return { ok: true };
  },
  ac_extensions_watch_actions: () => ({ ok: true }),
  ac_extensions_sync_state: () => ({ ready: true, extensions: [], pending: [], intents: [] }),
  ac_extensions_sync_apply: () => ({ ok: true, applied: 0 }),
  ac_omnibox_opened: () => ({ prewarm: 0 }),
  ac_task_manager_open: () => ({ ok: true }),
  ac_memory_trim: () => ({ ok: true }),
  ac_battery_saver: (_name, args) => {
    if (args.mode === "on" || args.mode === "off" || args.mode === "default") batterySaver = args.mode;
    return { state: batterySaver === "on" ? 1 : 0, active: batterySaver === "on" };
  },
  ac_cli_control: (_name, args) => {
    if (args.on === true && cliControl.state === "off") cliControl = { ...cliControl, state: "on", port: 9333, generation: cliControl.generation + 1 };
    if (args.on === false) cliControl = { ...cliControl, state: "off", port: undefined, connections: 0 };
    return { ...cliControl, ...(cliControl.port ? {} : { port: undefined }) };
  },
};

export function engineCall(name: unknown, profileName: unknown, json: unknown): string {
  const handler = engineCalls[String(name)];
  if (!handler) return JSON.stringify({ error: `unknown engine call ${String(name)}` });
  let args: Record<string, unknown> = {};
  try {
    args = typeof json === "string" && json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    return JSON.stringify({ error: "invalid arguments" });
  }
  try {
    return JSON.stringify(handler(String(profileName ?? ""), args) ?? {});
  } catch (error) {
    return JSON.stringify({ error: String((error as Error).message ?? error) });
  }
}

export function savePasswords() {
  save();
}

export const MOCK_EXTENSION = {
  id: "mockextensionaaaaaaaaaaaaaaaaaaaa",
  name: "Mock Notes",
  version: "1.4.2",
  description: "A sample extension the mock engine reports so the extension UI has something to show.",
  enabled: true,
  state: "ENABLED",
  icon: "",
  permissions: ["storage", "activeTab"],
  siteAccess: "ON_CLICK",
  sites: [],
  optionsUrl: null,
  pinned: false,
  incognito: false,
  fileAccess: false,
  mayModify: true,
  errors: [],
  location: "FROM_STORE",
  path: null,
  fromWebStore: true,
  webStoreUrl: "https://chromewebstore.google.com/detail/mockextensionaaaaaaaaaaaaaaaaaaaa",
  homepageUrl: null,
  hasAction: true,
  popup: null,
  actionTitle: "Mock Notes",
  actionIcon: null,
  sidePanel: null,
};
