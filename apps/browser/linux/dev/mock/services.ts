import { documents, emit, hashOf, letterIcon, MockError, now, options, sleep, type HandlerTable } from "./core";
import { engineCall, MOCK_EXTENSION, profile, savePasswords } from "./data";
import { cancelDownload, pauseDownload, resumeDownload } from "./downloads";
import { bindingFor, runBinding, sendCommand } from "./keys";
import { pagerState, selectPager, stepPager, switchPager } from "./pagers";
import { swipeLocation } from "./views";
import { getSiteSettings, resetSiteSettings, resolvePermission, setSiteSetting, siteSettingsOrigins } from "./permissions";
import { showDialog, showMenu } from "./ui";
import { webViewByBrowserId, webViewMethods, webViews } from "./webViews";
import {
  closeWindow,
  focusedDocumentWindow,
  focusWindow,
  isDark,
  openWindow,
  openWindowIds,
  setAppearance,
  setWindowTitle,
  windowFor,
  windowFrame,
  windows,
  type WindowOptions,
} from "./windows";

const APP_VERSION = "0.2.40";

const nodeForTag = (tag: unknown): Element | null =>
  (globalThis as { __ardiaNodeForTag?: (tag: number) => Element | null }).__ardiaNodeForTag?.(Number(tag)) ?? null;

const updater = { automaticChecks: true, automaticDownloads: true, channel: "stable" as "stable" | "nightly", lastCheck: null as number | null, sessionInProgress: false };
let appIconId = "default";
let scriptState: unknown = null;
let menuState: unknown = null;
let menuBookmarks: unknown = null;
let inDock = false;
let launchAtLogin = false;
let defaultBrowser = false;
let notificationSeq = 1;
let dragPreview: { windowId: string; shape: string; point: [number, number] } | null = null;
let tracing = false;
let displayMediaPicker = false;
let videoUpscaling = { enabled: false, lowPower: false, thermalPressure: false };
let searchEngineName = "Google";
let autoPictureInPicture = true;
let tabStripRev = 0;
let userScriptsWatching = false;
let userScriptsStatus: string | null = null;
let castRoutesWatched = false;
let syncDevice = `linux-${(hashOf(navigator.userAgent) % 100000).toString(36)}`;
const keychain = new Map<string, string>();
const unlockedSync = new Set<string>();
const syncChains = new Map<string, Map<string, Map<string, string>>>();
const contentBlocker = {
  enabled: true,
  lists: [
    { id: "ublock-filters", title: "uBlock filters", category: "ads", enabled: true, defaultOn: true, filters: 41210 },
    { id: "easylist", title: "EasyList", category: "ads", enabled: true, defaultOn: true, filters: 72504 },
    { id: "easyprivacy", title: "EasyPrivacy", category: "trackers", enabled: true, defaultOn: true, filters: 50122 },
    { id: "cookie-notices", title: "Cookie notices", category: "cookies", enabled: false, defaultOn: false, filters: 18044 },
    { id: "annoyances", title: "Annoyances", category: "annoyances", enabled: false, defaultOn: false, filters: 9120 },
    { id: "malware", title: "Malicious URL blocklist", category: "security", enabled: true, defaultOn: true, filters: 3150 },
  ],
  allowedHosts: new Set<string>(),
};
const extensions = new Map<string, Record<string, unknown>>([[MOCK_EXTENSION.id, { ...MOCK_EXTENSION, icon: `data:image/png;base64,${letterIcon("Notes", 48)}` }]]);
let lastFileDrag: unknown = null;

const contentBlockerStats = () => ({
  ready: true,
  enabled: contentBlocker.enabled,
  networkFilters: contentBlocker.lists.filter((list) => list.enabled).reduce((sum, list) => sum + list.filters, 0),
  cosmeticFilters: 12840,
  unsupportedFilters: 312,
  parseMs: 84,
  lookups: 1520,
  averageLookupMicros: 3.2,
  maxLookupMicros: 41,
});

const contentBlockerState = () => ({
  enabled: contentBlocker.enabled,
  version: "1.62.0",
  lists: contentBlocker.lists.map((list) => ({ ...list })),
  allowedHosts: [...contentBlocker.allowedHosts].sort(),
  stats: contentBlockerStats(),
});

const extensionsChanged = (profileName: string) =>
  emit("ArdiaExtensions", "onChanged", { profile: profileName, extensions: [...extensions.values()] });

const systemInfo = () => ({
  appName: "Ardia",
  appVersion: APP_VERSION,
  appBuild: "240",
  bundleId: "dev.ardia.Ardia",
  configuration: "Release",
  osVersion: "Linux (mock engine)",
  osBuild: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "",
  arch: /aarch64|arm/i.test(navigator.userAgent) ? "arm64" : "x86_64",
  model: "Linux",
  memoryGB: 16,
  locale: navigator.language || "en-US",
  updates: true,
  feedbackURL: null,
  feedbackEmail: null,
  videoTourURL: null,
  releaseNotesURL: `https://ardia.dev/releases/${APP_VERSION}`,
  isolatedInstance: options.isolatedInstance ?? false,
  forceReleaseNotes: false,
  processStart: performance.timeOrigin,
  bootTime: performance.timeOrigin - 3600e3,
  inApplicationsFolder: true,
});

const updaterState = () => ({
  available: true,
  configured: true,
  automaticChecks: updater.automaticChecks,
  automaticDownloads: updater.automaticDownloads,
  canCheck: !updater.sessionInProgress,
  sessionInProgress: updater.sessionInProgress,
  feedURL: `https://ardia.dev/appcast-linux${updater.channel === "nightly" ? "-nightly" : ""}.xml`,
  lastCheck: updater.lastCheck,
  version: APP_VERSION,
  displayVersion: APP_VERSION,
  channel: updater.channel,
  buildChannel: "stable",
});

const MENU_SHORTCUTS = [
  ["newTab", "New Tab", ["File"], "t", ["command"]],
  ["newWindow", "New Window", ["File"], "n", ["command"]],
  ["reopenClosedTab", "Reopen Closed Tab", ["File"], "t", ["command", "shift"]],
  ["focusCommandBar", "Open Command Bar", ["File"], "l", ["command"]],
  ["closeTab", "Close Tab", ["File"], "w", ["command"]],
  ["findInPage", "Find…", ["Edit", "Find"], "f", ["command"]],
  ["reload", "Refresh", ["View"], "r", ["command"]],
  ["toggleSidebar", "Auto-Hide Tabs", ["View"], "s", ["command"]],
  ["bookmarkPage", "Bookmark This Page", ["Bookmarks"], "d", ["command"]],
  ["openSettings", "Settings…", ["Ardia"], ",", ["command"]],
].map(([id, title, path, key, modifiers]) => ({ id, title, path, key, modifiers, defaultKey: key, defaultModifiers: modifiers, remappable: true }));

const windowArg = (id: unknown) => String(id ?? "");

const dialogWindow = (windowId: unknown) => windowFor(typeof windowId === "string" ? windowId : null) ?? focusedDocumentWindow();

const nativeElementWrite = (tag: unknown, typed: string, completion: string): number => {
  const node = nodeForTag(tag);
  const field = node && (node.matches("input, textarea") ? node : node.querySelector("input, textarea"));
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && !(field && "value" in field)) return 0;
  const input = field as HTMLInputElement;
  if (input.value !== typed) return 2;
  input.value = typed + completion;
  input.setSelectionRange(typed.length, typed.length + completion.length);
  return 1;
};

const syncFolder = (folder: unknown) => {
  const key = String(folder ?? "");
  let chain = syncChains.get(key);
  if (!chain) syncChains.set(key, (chain = new Map()));
  return chain;
};

const syncScope = (folder: unknown, scope: unknown) => {
  const chain = syncFolder(folder);
  let records = chain.get(String(scope));
  if (!records) chain.set(String(scope), (records = new Map()));
  return records;
};

const RECOVERY_WORDS = "orbit maple river canvas quiet ember lunar thimble harbor velvet saddle pioneer".split(" ");

const calendarNow = () => {
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  return start.getTime();
};

export const handlers: HandlerTable = {
  ArdiaApp: {
    updaterState,
    checkForUpdates: async () => {
      updater.sessionInProgress = true;
      await sleep(300);
      updater.sessionInProgress = false;
      updater.lastCheck = now();
    },
    setAutomaticUpdateChecks: (on) => void (updater.automaticChecks = !!on),
    setAutomaticUpdateDownloads: (on) => void (updater.automaticDownloads = !!on),
    setUpdateChannel: (channel) => void (updater.channel = channel === "nightly" ? "nightly" : "stable"),
    setWindowActivity: () => null,
    share: () => null,
    shareVia: () => null,
    isInDock: () => inDock,
    addToDock: () => (inDock = true),
    appIcons: (size) =>
      ["default", "midnight", "paper", "sunset"].map((id) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), preview: `data:image/png;base64,${letterIcon(`A${id}`, Number(size) || 64)}` })),
    appIcon: () => appIconId,
    setAppIcon: (id) => void (appIconId = String(id)),
    notificationPermission: () => "granted",
    requestNotificationPermission: () => true,
    postNotification: (notification) => {
      const spec = (notification ?? {}) as { id?: string };
      return spec.id ?? `notification-${notificationSeq++}`;
    },
    removeNotifications: () => null,
    openNotificationSettings: () => null,
    setScriptState: (state) => void (scriptState = state),
    replyToScript: () => null,
    systemInfo,
    crashReports: () => [],
    devCrash: () => {
      throw new MockError("ERR_CRASH", "The mock engine does not crash");
    },
    openExternalURL: (url) => {
      console.info(`[mock] openExternalURL ${String(url)}`);
      return true;
    },
    playIntroMusic: () => null,
    setIntroMusicMuted: () => null,
    stopIntroMusic: () => null,
    devRenderIntroMusic: () => null,
    launchEnvironment: (name) => options.env?.[String(name)] ?? null,
    killSwitchEnvironment: (name) => options.env?.[String(name)] ?? null,
    devMenuCommand: (command, arg) => sendCommand(String(command), arg == null ? null : String(arg), null),
    devPostKey: (windowId, key, modifiers) => {
      const mods = (modifiers ?? []) as string[];
      const event = { key: String(key), ctrlKey: mods.includes("command") || mods.includes("control"), shiftKey: mods.includes("shift"), altKey: mods.includes("option"), metaKey: false };
      const binding = bindingFor(event);
      if (binding) runBinding(binding, windowArg(windowId));
      return !!binding;
    },
    devPostKeys: () => true,
    devMenuItems: () => [],
    devDragBlockedRects: () => [],
    devSnapshotWindow: () => false,
    devSetPointer: () => true,
    devLeftEdgePointer: () => true,
    devLeftEdgeStats: () => ({ entries: 0, exits: 0 }),
    devHoverStats: () => ({ passes: 0, log: [], registered: 0 }),
    devSetMouseButtons: () => true,
    devTypeKeys: (windowId, text) => {
      const win = windowFor(windowArg(windowId)) ?? focusedDocumentWindow();
      const field = win.document.activeElement as HTMLInputElement | null;
      if (field && "value" in field) {
        field.value += String(text);
        field.dispatchEvent(new (win as Window & typeof globalThis).InputEvent("input", { bubbles: true, data: String(text), inputType: "insertText" }));
      }
      return [];
    },
    devKeyEquivalent: (windowId, press) => {
      const spec = (press ?? {}) as { key?: string; modifiers?: string[] };
      const mods = spec.modifiers ?? ["command"];
      const binding = bindingFor({ key: spec.key ?? "", ctrlKey: mods.includes("command") || mods.includes("control"), shiftKey: mods.includes("shift"), altKey: mods.includes("option"), metaKey: false });
      if (binding) runBinding(binding, windowArg(windowId));
      return { handled: !!binding, command: binding?.command ?? null };
    },
    devKeyEquivalentTrace: () => [],
    devFocusHandoffTrace: () => [],
    devClick: (windowId, click) => {
      const spec = (click ?? {}) as { x?: number; y?: number };
      const win = windowFor(windowArg(windowId));
      const target = win?.document.elementFromPoint(spec.x ?? 0, spec.y ?? 0) as HTMLElement | null;
      target?.click();
      return { ok: !!target };
    },
    devRunAppleScript: () => ({ ok: false, error: "AppleScript is not available on Linux" }),
  },
  ArdiaAreaLight: {
    debugSnapshot: () => null,
  },
  ArdiaCEF: {
    engineInfo: () => ({
      pid: 4242,
      dataDirectory: "/home/ardia/.config/Ardia",
      engine: "mock",
      chromiumVersion: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "155.0.0.0",
      liveBrowsers: webViews.size,
      popupWindows: 0,
      chromeWindows: 0,
    }),
    forwardEngineTopics: () => null,
    chromeWindows: () => [],
    devExternalLaunches: () => [],
    devEvents: () => [],
    devWindowNumber: (windowId) => windows.get(windowArg(windowId))?.number ?? 0,
    devPictureInPicture: () => null,
    devPictureInPictureAction: () => null,
    devFocusPage: (browserId) => {
      const view = webViewByBrowserId(Number(browserId));
      view?.element?.contentWindow?.focus();
      return !!view;
    },
    devWindow: () => "",
    prepareTransfer: () => null,
    releaseTransfer: () => null,
    claimLaunchTab: () => null,
    revealTab: () => null,
    dropTabReveals: () => null,
    revealOffered: () => null,
    routeLinkTabs: () => ({}),
    tabStripCommand: (id) => {
      tabStripRev++;
      window.setTimeout(() => emit("ArdiaCEF", "onTabStrip", { rev: tabStripRev, cmd: Number(id), strips: [] }), 0);
    },
    tabStrips: () => ({ rev: tabStripRev, cmd: null, strips: [] }),
    components: () => [
      { id: "oimompecagnajdejgnnjijobebaeigek", name: "Widevine Content Decryption Module", version: "4.10.2891.0", state: "upToDate" },
      { id: "hfnkpimlhhgieaddgfemjhofmfblmnib", name: "CRLSet", version: "9876", state: "upToDate" },
    ],
    beginTracing: () => (tracing = true),
    endTracing: (keep) => {
      tracing = false;
      return keep ? "/tmp/ardia-trace.json" : null;
    },
    isTracing: () => tracing,
    setSearchEngineName: (name) => void (searchEngineName = String(name)),
    setDisplayMediaPicker: (enabled) => void (displayMediaPicker = !!enabled),
    setAutoPictureInPicture: (enabled) => void (autoPictureInPicture = !!enabled),
    setVideoUpscaling: (enabled) => void (videoUpscaling.enabled = !!enabled),
    setVideoUpscalingTestConditions: (conditions) => {
      const spec = (conditions ?? {}) as { lowPower?: boolean; thermalPressure?: boolean };
      videoUpscaling = { ...videoUpscaling, lowPower: !!spec.lowPower, thermalPressure: !!spec.thermalPressure };
    },
    videoUpscalingState: () => ({ ...videoUpscaling, appActive: document.hasFocus(), tabs: [...webViews.values()].map((view) => ({ tabId: view.tabId, allowed: videoUpscaling.enabled })) }),
    displayMediaSources: () => [
      { id: "screen:0", kind: "screen", title: "Entire screen", thumbnail: null },
      ...[...windows.values()].map((record, index) => ({ id: `window:${index + 1}`, kind: "window", title: record.title, thumbnail: null })),
    ],
    listTasks: () => [
      { id: 1, type: "browser", title: "Browser", killable: false, cpu: 2.1, processors: 4, memory: 182e6, gpuMemory: 0, browserIds: [] },
      { id: 2, type: "gpu", title: "GPU Process", killable: false, cpu: 0.8, processors: 4, memory: 96e6, gpuMemory: 64e6, browserIds: [] },
      ...[...webViews.values()].map((view, index) => ({
        id: 10 + index,
        type: "renderer",
        title: `Tab: ${view.entries[view.index]?.title || view.entries[view.index]?.url || "New Tab"}`,
        killable: true,
        cpu: 0.4,
        processors: 4,
        memory: 48e6 + (hashOf(String(view.viewId)) % 30e6),
        gpuMemory: 0,
        browserIds: [view.browserId],
      })),
    ],
    systemState: () => ({ onBattery: false, batteryLevel: null, lowPowerMode: false, memoryPressure: "normal", physicalMemory: 16 * 2 ** 30 }),
    inputIdleSeconds: () => 0,
    cancelDownload: (id) => cancelDownload(String(id)),
    pauseDownload: (id) => pauseDownload(String(id)),
    resumeDownload: (id) => resumeDownload(String(id)),
    resolvePermission: (id, result, remember) => resolvePermission(String(id), String(result), !!remember),
    resolveExternalApp: () => null,
    getExternalAppAllowances: (profileName) => profile(profileName).externalApps,
    removeExternalAppAllowance: (profileName, origin, scheme) => {
      const data = profile(profileName);
      data.externalApps = data.externalApps.filter((entry) => entry.origin !== origin || entry.scheme !== scheme);
    },
    clearBrowsingData: (profileName, types) => {
      const kinds = (types ?? []) as string[];
      if (kinds.includes("history")) profile(profileName).history.clear();
      savePasswords();
    },
    releaseProfile: () => null,
    deleteProfileData: () => ({ remaining: [] }),
    fetchFavicon: (url) => ({ uri: `data:image/png;base64,${letterIcon(new URL(String(url), "https://x").hostname, 32)}`, width: 32, height: 32 }),
    engineCall: (name, profileName, json) => engineCall(name, profileName, json),
    getContentBlocker: contentBlockerState,
    setContentBlockerEnabled: (enabled) => {
      contentBlocker.enabled = !!enabled;
      emit("ArdiaCEF", "onContentBlocker", contentBlockerStats());
    },
    setFilterListEnabled: (id, enabled) => {
      const list = contentBlocker.lists.find((entry) => entry.id === id);
      if (list) list.enabled = !!enabled;
      emit("ArdiaCEF", "onContentBlocker", contentBlockerStats());
    },
    isContentBlockerAllowed: (host) => contentBlocker.allowedHosts.has(String(host)),
    setContentBlockerAllowed: (host, allowed) => {
      if (allowed) contentBlocker.allowedHosts.add(String(host));
      else contentBlocker.allowedHosts.delete(String(host));
    },
    devContentBlockerFailNextMessage: () => null,
    devContentBlockerDelayNextLoad: () => null,
    setSiteSetting: (profileName, origin, type, value) => setSiteSetting(String(profileName), String(origin), String(type), String(value)),
    getSiteSettings: (profileName, origin) => getSiteSettings(String(profileName), String(origin)),
    getSiteSettingsOrigins: (profileName) => siteSettingsOrigins(String(profileName)),
    resetSiteSettings: (profileName, origin) => resetSiteSettings(String(profileName), String(origin)),
    clearSiteData: () => ({ cookies: 3, storage: true }),
    setZoom: (profileName, host, zoom) => {
      const data = profile(profileName);
      if (Number(zoom) === 1) delete data.zoom[String(host)];
      else data.zoom[String(host)] = Number(zoom);
      savePasswords();
    },
    getZoomLevels: (profileName) => ({ ...profile(profileName).zoom }),
    devScrollZoom: () => null,
    listPasswords: (profileName) => ({
      passwords: profile(profileName).passwords.map(({ origin, username, created, modified }) => ({ origin, username, created, modified })),
    }),
    unlockPasswords: () => ({ unlocked: true }),
    getPassword: (profileName, origin, username) => ({
      password: profile(profileName).passwords.find((entry) => entry.origin === origin && entry.username === username)?.password ?? null,
    }),
    savePassword: (profileName, origin, username, password) => {
      const data = profile(profileName);
      const existing = data.passwords.find((entry) => entry.origin === origin && entry.username === username);
      if (existing) {
        existing.password = String(password);
        existing.modified = now();
      } else data.passwords.push({ origin: String(origin), username: String(username), password: String(password), created: now(), modified: now() });
      savePasswords();
      return { ok: true };
    },
    updatePassword: (profileName, origin, username, newUsername, newPassword) => {
      const entry = profile(profileName).passwords.find((candidate) => candidate.origin === origin && candidate.username === username);
      if (!entry) return { error: "not found" };
      if (typeof newUsername === "string") entry.username = newUsername;
      if (typeof newPassword === "string") entry.password = newPassword;
      entry.modified = now();
      savePasswords();
      return { ok: true };
    },
    deletePassword: (profileName, origin, username) => {
      const data = profile(profileName);
      const before = data.passwords.length;
      data.passwords = data.passwords.filter((entry) => entry.origin !== origin || entry.username !== username);
      savePasswords();
      return before === data.passwords.length ? { error: "not found" } : { ok: true };
    },
    getNeverSavePasswordOrigins: (profileName) => ({ origins: [...profile(profileName).neverSave].sort() }),
    allowSavingPasswords: (profileName, origin) => {
      profile(profileName).neverSave.delete(String(origin));
      return { ok: true };
    },
    exportPasswords: (profileName) => (profile(profileName).passwords.length ? { status: "succeeded", path: "/home/ardia/Documents/Ardia Passwords.csv" } : { status: "succeeded", path: "/home/ardia/Documents/Ardia Passwords.csv" }),
    getPasswordAutofill: (profileName) => profile(profileName).passwordAutofill,
    setPasswordAutofill: (profileName, enabled) => void (profile(profileName).passwordAutofill = !!enabled),
    getAutofillSettings: (profileName) => ({ ...profile(profileName).autofill }),
    setAutofillSettings: (profileName, addresses, cards) => {
      const settings = profile(profileName).autofill;
      if (typeof addresses === "boolean") settings.addresses = addresses;
      if (typeof cards === "boolean") settings.cards = cards;
    },
    listAddresses: (profileName) => ({ addresses: profile(profileName).addresses }),
    saveAddress: (profileName, address) => {
      const data = profile(profileName);
      const input = (address ?? {}) as Record<string, unknown>;
      const id = typeof input.id === "string" ? input.id : `address-${now().toString(36)}`;
      const existing = data.addresses.find((entry) => entry.id === id);
      if (existing) Object.assign(existing, input, { modified: now() });
      else data.addresses.push({ ...input, id, created: now(), modified: now() });
      return { id };
    },
    listCards: (profileName) => ({ cards: profile(profileName).cards.map(({ number: _number, ...card }) => card) }),
    saveCard: (profileName, card, number) => {
      const data = profile(profileName);
      const input = (card ?? {}) as Record<string, unknown>;
      const id = typeof input.id === "string" ? input.id : `card-${now().toString(36)}`;
      const digits = typeof number === "string" ? number.replace(/\D/g, "") : "";
      const existing = data.cards.find((entry) => entry.id === id);
      const network = /^4/.test(digits) ? "visa" : /^5[1-5]/.test(digits) ? "mastercard" : /^3[47]/.test(digits) ? "amex" : "card";
      if (existing) Object.assign(existing, input, { modified: now() }, digits ? { number: digits, last4: digits.slice(-4), network } : {});
      else data.cards.push({ ...input, id, network, last4: digits.slice(-4), number: digits, created: now(), modified: now() });
      return { id };
    },
    deleteAutofillEntry: (profileName, id) => {
      const data = profile(profileName);
      data.addresses = data.addresses.filter((entry) => entry.id !== id);
      data.cards = data.cards.filter((entry) => entry.id !== id);
      return { ok: true };
    },
    revealCardNumber: (profileName, id) => ({ number: profile(profileName).cards.find((entry) => entry.id === id)?.number ?? null }),
  },
  "ArdiaCEF.view": webViewMethods as Record<string, (...args: unknown[]) => unknown>,
  ArdiaCalendar: {
    authorizationStatus: () => "notDetermined",
    requestAccess: () => false,
    calendars: () => [{ id: "mock-calendar", title: "Personal", color: "#3b82f6", account: "Local", accountType: "local", owned: true }],
    events: (start, end) => {
      const at = calendarNow();
      if (at < Number(start) || at > Number(end)) return [];
      return [
        {
          id: "mock-event",
          occurrence: String(at),
          calendarId: "mock-calendar",
          color: "#3b82f6",
          title: "Design review",
          start: at,
          end: at + 45 * 60e3,
          allDay: false,
          location: "",
          notes: "",
          url: "",
          cancelled: false,
          declined: false,
          organizer: null,
          attendees: [],
        },
      ];
    },
  },
  ArdiaChromeUI: {
    selectDevice: () => null,
    cancelDeviceChooser: () => null,
    refreshDeviceChooser: () => null,
    openBluetoothSettings: () => null,
    devShowBluetoothChooser: () => null,
    devChooserEvents: () => [],
    showCastDialog: () => false,
    startCasting: () => null,
    stopCasting: () => null,
    closeCastDialog: () => null,
    watchCastRoutes: (profileName) => {
      castRoutesWatched = true;
      window.setTimeout(() => emit("ArdiaChromeUI", "onCastRoutes", { profile: String(profileName), routes: [] }), 0);
    },
    terminateCastRoute: () => null,
    actionStates: (_browserId, ids) =>
      Object.fromEntries(
        ((ids ?? []) as string[]).map((id) => [
          id,
          { title: String(extensions.get(id)?.name ?? id), badgeText: "", badgeColor: null, badgeTextColor: null, popup: "", enabled: true, icon: String(extensions.get(id)?.icon ?? "") },
        ]),
      ),
    sidePanelURL: () => null,
    changeCaptureSource: () => false,
    stopCapture: () => false,
    showAutofillSuggestions: () => false,
  },
  ArdiaCli: {
    installedVersion: () => null,
    install: async () => {
      const lines = ["Linking /usr/local/bin/ardia", "Done"];
      for (const line of lines) {
        emit("ArdiaCli", "onInstallLine", { line });
        await sleep(40);
      }
      return { ok: true, appVersion: APP_VERSION, binPath: "/home/ardia/.local/bin/ardia", version: APP_VERSION, installedVersion: APP_VERSION, lines };
    },
  },
  ArdiaDockSelection: {
    iconTheme: () => ({ kind: "blur" }),
  },
  ArdiaExtensions: {
    resolveInstallPrompt: () => null,
    list: () => ({ extensions: [...extensions.values()] }),
    inspectUnpacked: (path) => ({ name: String(path).split("/").pop() ?? "Unpacked", version: "0.0.1", permissions: [], hostPermissions: [], manifestVersion: 3 }),
    install: (profileName, id) => {
      const extension = { ...MOCK_EXTENSION, id: String(id), name: `Extension ${String(id).slice(0, 6)}`, pinned: false, icon: `data:image/png;base64,${letterIcon(String(id), 48)}` };
      extensions.set(String(id), extension);
      extensionsChanged(String(profileName));
      return { id: String(id), name: extension.name };
    },
    installCrx: () => ({ error: "CRX install is not mocked" }),
    setEnabled: (profileName, id, enabled) => {
      const extension = extensions.get(String(id));
      if (!extension) return { error: "not installed" };
      extension.enabled = !!enabled;
      extension.state = enabled ? "ENABLED" : "DISABLED";
      extensionsChanged(String(profileName));
      return { ok: true };
    },
    uninstall: (profileName, id) => {
      extensions.delete(String(id));
      extensionsChanged(String(profileName));
      return { ok: true };
    },
    reload: () => ({ ok: true }),
    configure: (profileName, id, settings) => {
      const extension = extensions.get(String(id));
      if (!extension) return { error: "not installed" };
      Object.assign(extension, settings ?? {});
      extensionsChanged(String(profileName));
      return { ok: true };
    },
    searchEngineList: () => ({ list: [] }),
    chooseFolder: () => null,
  },
  ArdiaFileDrop: {
    devDrag: (...args) => {
      lastFileDrag = args;
      return true;
    },
    devLastFileDrag: () => lastFileDrag,
  },
  ArdiaGlassEffect: {
    isLiquidGlass: () => false,
  },
  ArdiaImport: {
    listBrowsers: () =>
      JSON.stringify([
        {
          id: "chrome",
          name: "Google Chrome",
          family: "chromium",
          requiresExport: false,
          needsKeychain: true,
          profiles: [{ id: "Default", name: "Person 1", path: "/home/ardia/.config/google-chrome/Default", isDefault: true, available: ["bookmarks", "history", "tabs", "passwords", "autofill"] }],
        },
        {
          id: "firefox",
          name: "Firefox",
          family: "firefox",
          requiresExport: false,
          needsKeychain: false,
          profiles: [{ id: "default-release", name: "default-release", path: "/home/ardia/.mozilla/firefox/abcd.default-release", isDefault: true, available: ["bookmarks", "history", "passwords"] }],
        },
      ]),
    importData: async (jobId) => {
      await sleep(200);
      emit("ArdiaImport", "onImportEvent", { jobId, kind: "progress", done: 1, total: 1 });
      return JSON.stringify({ token: `import-${String(jobId)}`, counts: { bookmarks: 0, history: 0, passwords: 0 } });
    },
    cancelImport: () => null,
    unlockBrowser: () => null,
    isBrowserUnlocked: () => true,
    forgetUnlockedKeys: () => null,
    writeImported: () => JSON.stringify({ written: {} }),
    discardImported: () => null,
    listExtensions: () => JSON.stringify([]),
    importSafariExport: () => {
      throw new MockError("unsupported", "Safari is not available on Linux");
    },
    safariHasFullDiskAccess: () => false,
    openFullDiskAccessSettings: () => null,
    importSafariDirect: () => {
      throw new MockError("unsupported", "Safari is not available on Linux");
    },
    diaAutomationStatus: () => JSON.stringify({ status: "unavailable" }),
    requestDiaAutomation: () => JSON.stringify({ status: "unavailable" }),
    openAutomationSettings: () => null,
    openDia: () => null,
    readDiaTabs: () => JSON.stringify({ tabs: [] }),
    importBookmarksHTML: () => JSON.stringify({ bookmarks: [] }),
    importPasswordsCSV: () => JSON.stringify({ passwords: [] }),
    chooseImportFile: () => null,
  },
  ArdiaInlineCompletion: {
    complete: (tag, typed, completion) => nativeElementWrite(tag, String(typed), String(completion)),
  },
  ArdiaKeychain: {
    get: (account) => keychain.get(String(account)) ?? null,
    set: (account, secret) => {
      keychain.set(String(account), String(secret));
      return true;
    },
    delete: (account) => keychain.delete(String(account)),
  },
  ArdiaShell: {
    openWindow: (id, windowOptions) => openWindow(String(id), (windowOptions ?? {}) as WindowOptions),
    closeWindow: (id) => closeWindow(String(id)),
    setTrafficLightsCenter: (id, center) => {
      const record = windows.get(String(id));
      if (record) record.lightsCenter = (center as [number, number] | null) ?? null;
    },
    watchLeftEdge: (id, on) => {
      const record = windows.get(String(id));
      if (record) record.leftEdge = !!on;
    },
    focusWindow: (id) => focusWindow(String(id)),
    dragPreviewBegin: (windowId, _chip, grab) => void (dragPreview = { windowId: String(windowId), shape: "pill", point: (grab as [number, number]) ?? [0, 0] }),
    dragPreviewPage: () => null,
    dragPreviewUpdate: (shape, point) => {
      if (dragPreview) dragPreview = { ...dragPreview, shape: String(shape), point: point as [number, number] };
    },
    dragPreviewCancel: () => void (dragPreview = null),
    raiseView: () => null,
    dragPreviewPlaceholder: () => null,
    windowFrame: (id) => windowFrame(String(id)),
    devDragPreviewState: () => dragPreview,
    dragPreviewEnd: () => void (dragPreview = null),
    setWindowTitle: (id, title) => setWindowTitle(String(id), String(title)),
    windowIds: () => openWindowIds(),
    setAppearance: (mode) => setAppearance(String(mode) as "auto" | "light" | "dark"),
    isDarkAppearance: () => isDark(),
    setMenuState: (state) => void (menuState = state),
    setMenuBookmarks: (bookmarks) => void (menuBookmarks = bookmarks),
    replyToTerminate: (ok) => {
      if (ok) for (const id of [...windows.keys()]) closeWindow(id);
    },
    confirm: async (spec) => {
      const dialog = (spec ?? {}) as { title?: string; message?: string; confirmTitle?: string; cancelTitle?: string; destructive?: boolean; suppression?: string; windowId?: string };
      if (typeof options.autoConfirm === "boolean") return { confirmed: options.autoConfirm, suppressed: false };
      const result = await showDialog(dialogWindow(dialog.windowId), { ...dialog, title: dialog.title ?? "" });
      return { confirmed: result.confirmed, suppressed: result.suppressed };
    },
    prompt: async (spec) => {
      const dialog = (spec ?? {}) as { title?: string; message?: string; value?: string; placeholder?: string; confirmTitle?: string; windowId?: string };
      if (typeof options.autoConfirm === "boolean") return options.autoConfirm ? (dialog.value ?? "") : null;
      const result = await showDialog(dialogWindow(dialog.windowId), { title: dialog.title ?? "", message: dialog.message, confirmTitle: dialog.confirmTitle, input: { value: dialog.value, placeholder: dialog.placeholder } });
      return result.value;
    },
    startDictation: () => null,
    pickFiles: () => [],
    readDocument: (name) => documents.get(String(name)),
    writeDocument: (name, contents) => documents.set(String(name), String(contents)),
    removeDocument: (name) => documents.remove(String(name)),
    fetchBangList: () => ({ status: 304, etag: null, contentType: null, body: null, bytes: 0 }),
    saveDocument: (name, contents) => documents.set(String(name), String(contents)),
    cancelFocusMove: () => null,
    claimFocus: (_generation, tag) => {
      const node = nodeForTag(tag) as HTMLElement | null;
      node?.focus?.();
    },
    setSwitcherCapture: () => null,
    setDragEscapeCapture: () => null,
    switcherPointerMoved: () => true,
    copyText: (text) => {
      void navigator.clipboard?.writeText(String(text)).catch(() => {});
    },
    showMenu: (items) => showMenu(focusedDocumentWindow(), (items ?? []) as Parameters<typeof showMenu>[1]),
  },
  ArdiaSwipe: {
    haptic: () => null,
    switchPager: (key, index, order) => switchPager(key, index, order),
    selectPager: (key, profileId, order) => selectPager(key, profileId, order),
    stepPager: (key, delta, wrap, order) => stepPager(key, delta, wrap, order),
    pagerState: (key) => pagerState(key),
    devPagerState: (key) => pagerState(key),
    devSimulate: () => ({ ok: true, steps: 0 }),
  },
  "ArdiaSwipe.view": {
    devLocate: (viewId) => swipeLocation(Number(viewId)),
  },
  ArdiaSync: {
    folderInfo: (path) => ({
      path: typeof path === "string" && path ? path : "/home/ardia/Sync/Ardia",
      defaultPath: "/home/ardia/Sync/Ardia",
      iCloudAvailable: false,
      inICloud: false,
      exists: syncChains.has(String(path ?? "")),
      writable: true,
      hasSyncData: syncChains.has(String(path ?? "")),
    }),
    chooseFolder: (current) => (typeof current === "string" && current ? current : "/home/ardia/Sync/Ardia"),
    newDeviceId: () => (syncDevice = `linux-${crypto.randomUUID().slice(0, 8)}`),
    deviceName: () => "Linux desktop",
    createPhrase: (account) => {
      unlockedSync.add(String(account));
      return true;
    },
    enterPhrase: (account, text) => {
      const words = String(text).trim().split(/\s+/);
      if (words.length !== 12) return { error: "wordCount", count: words.length };
      unlockedSync.add(String(account));
      return { ok: true };
    },
    unlock: (account) => unlockedSync.has(String(account)),
    forget: (account) => void unlockedSync.delete(String(account)),
    chainStatus: (folder) => (syncChains.has(String(folder)) ? "ok" : "missing"),
    createChain: (folder) => void syncFolder(folder),
    write: (folder, scope, payload) => {
      const id = `${syncDevice}-${now().toString(36)}`;
      syncScope(folder, scope).set(id, String(payload));
      return id;
    },
    read: (folder, scope, known) => {
      const seen = new Set((known ?? []) as string[]);
      const records = syncScope(folder, scope);
      return { files: [...records].filter(([id]) => !seen.has(id)).map(([id, payload]) => ({ id, payload })), pending: [], damaged: [], present: [...records.keys()] };
    },
    remove: (folder, scope, ids) => {
      const records = syncScope(folder, scope);
      for (const id of (ids ?? []) as string[]) records.delete(id);
    },
    deleteChain: (folder) => void syncChains.delete(String(folder)),
    sealLocal: (text) => btoa(unescape(encodeURIComponent(String(text)))),
    openLocal: (sealed) => {
      try {
        return decodeURIComponent(escape(atob(String(sealed))));
      } catch {
        return null;
      }
    },
    recoveryWords: () => RECOVERY_WORDS,
    qrCode: () => `data:image/png;base64,${letterIcon("QR", 128)}`,
    recoveryKitPreview: (width) => `data:image/png;base64,${letterIcon("Kit", Math.min(256, Number(width) || 128))}`,
    saveRecoveryKit: (format) => `/home/ardia/Documents/Ardia Recovery Kit.${format === "text" ? "txt" : "pdf"}`,
    copyRecoveryKit: () => null,
    shareRecoveryKit: () => null,
    copyRecoveryPhrase: () => {
      void navigator.clipboard?.writeText(RECOVERY_WORDS.join(" ")).catch(() => {});
    },
    revealFolder: () => null,
    readPasswords: (profileName) => profile(profileName).passwords.map(({ origin, username, password, created }) => ({ origin, url: origin, username, password, created })),
  },
  ArdiaSystem: {
    isDefaultBrowser: () => defaultBrowser,
    setAsDefaultBrowser: () => (defaultBrowser = true),
    launchAtLoginStatus: () => (launchAtLogin ? "enabled" : "notRegistered"),
    setLaunchAtLogin: (enabled) => void (launchAtLogin = !!enabled),
    fileExists: (path) => /^\/home\/ardia\/Downloads\//.test(String(path)),
    openFile: () => true,
    revealFile: () => true,
    moveToTrash: () => true,
    fileIcon: (path) => `data:image/png;base64,${letterIcon(String(path).split(".").pop() ?? "file", 32)}`,
    appIcon: (pid) => `data:image/png;base64,${letterIcon(`pid${String(pid)}`, 32)}`,
    hapticTick: () => null,
    menuShortcuts: () => MENU_SHORTCUTS,
    recordShortcut: () => null,
    cancelRecording: () => null,
  },
  ArdiaTranslate: {
    userLanguages: () => [...new Set([...(navigator.languages ?? []), "en"])].map((language) => language.split("-")[0]!),
    languageName: (identifier) => {
      try {
        return new Intl.DisplayNames(["en"], { type: "language" }).of(String(identifier)) ?? String(identifier);
      } catch {
        return String(identifier);
      }
    },
    detect: (text) => (/[äöüß]/i.test(String(text)) ? "de" : /[àâçéèêëîïôûùüÿœ]/i.test(String(text)) ? "fr" : "en"),
    status: () => "unsupported",
    supportedLanguages: () => [],
    prepare: () => null,
    translateBlocks: (_source, _target, blocks) => ((blocks ?? []) as string[][]).map(() => null),
    translate: (_source, _target, texts) => (texts ?? []) as string[],
  },
  ArdiaUserScripts: {
    watch: (on) => {
      userScriptsWatching = !!on;
    },
    read: () => ({ state: "absent", generation: 1, path: "/home/ardia/.config/Ardia/User Scripts" }),
    readStatus: () => userScriptsStatus,
    writeStatus: (json) => void (userScriptsStatus = String(json)),
  },
};

export const linuxOnlyHandlers: HandlerTable = {
  ArdiaShell: {
    beginWindowDrag: (windowId) => {
      const win = windowFor(windowArg(windowId));
      if (win) focusWindow(windowArg(windowId));
    },
  },
};

export const constants: Record<string, Record<string, unknown>> = {
  ArdiaApp: { apiVersion: 12 },
  ArdiaTranslate: { available: false },
};

export const mockState = () => ({
  scriptState,
  menuState,
  menuBookmarks,
  searchEngineName,
  displayMediaPicker,
  autoPictureInPicture,
  castRoutesWatched,
  userScriptsWatching,
  updater: updaterState(),
  dark: isDark(),
});
