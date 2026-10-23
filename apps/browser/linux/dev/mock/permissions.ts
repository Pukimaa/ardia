import { emit } from "./core";

type PermissionResult = "accept" | "deny" | "dismiss";

type Pending = { id: string; origin: string; permissions: string[]; resolve: (result: PermissionResult, remember: boolean) => void };

const pending = new Map<string, Pending>();
let nextPermission = 1;

export const SITE_SETTING_TYPES = [
  "popups",
  "camera",
  "microphone",
  "location",
  "notifications",
  "sound",
  "autoplay",
  "javascript",
  "images",
  "clipboard",
  "automaticDownloads",
  "cookies",
  "midi",
  "sensors",
  "windowManagement",
  "localFonts",
  "idleDetection",
  "storageAccess",
  "fileSystem",
  "keyboardLock",
  "pointerLock",
  "cameraPanTiltZoom",
] as const;

const DEFAULTS: Record<string, string> = {
  popups: "block",
  sound: "allow",
  autoplay: "allow",
  javascript: "allow",
  images: "allow",
  cookies: "allow",
  automaticDownloads: "ask",
};

const siteSettings = new Map<string, Map<string, Record<string, string>>>();

const settingsFor = (profile: string) => {
  let profileSettings = siteSettings.get(profile);
  if (!profileSettings) siteSettings.set(profile, (profileSettings = new Map()));
  return profileSettings;
};

export function setSiteSetting(profile: string, origin: string, type: string, value: string) {
  const forOrigin = settingsFor(profile).get(origin) ?? {};
  if (value === "default") delete forOrigin[type];
  else forOrigin[type] = value;
  settingsFor(profile).set(origin, forOrigin);
  if (Object.keys(forOrigin).length === 0) settingsFor(profile).delete(origin);
}

export function getSiteSettings(profile: string, origin: string) {
  const forOrigin = settingsFor(profile).get(origin) ?? {};
  return Object.fromEntries(
    SITE_SETTING_TYPES.map((type) => [type, { value: forOrigin[type] ?? DEFAULTS[type] ?? "ask", isDefault: !(type in forOrigin) }]),
  );
}

export const siteSettingsOrigins = (profile: string) => [...settingsFor(profile).keys()].sort();

export const resetSiteSettings = (profile: string, origin: string) => void settingsFor(profile).delete(origin);

const SETTING_FOR_PERMISSION: Record<string, string> = { location: "location", notifications: "notifications", camera: "camera", microphone: "microphone", midi: "midi" };

export function requestPermission(view: { browserId: number; props: Record<string, unknown> }, origin: string, permissions: string[]): Promise<PermissionResult> {
  const profile = String(view.props.profile ?? "");
  const saved = permissions.map((kind) => settingsFor(profile).get(origin)?.[SETTING_FOR_PERMISSION[kind] ?? kind]);
  if (saved.every((value) => value === "allow")) return Promise.resolve("accept");
  if (saved.some((value) => value === "block")) return Promise.resolve("deny");
  const id = `perm-${nextPermission++}`;
  return new Promise((resolve) => {
    pending.set(id, { id, origin, permissions, resolve: (result, remember) => {
      if (remember && result !== "dismiss") for (const kind of permissions) setSiteSetting(profile, origin, SETTING_FOR_PERMISSION[kind] ?? kind, result === "accept" ? "allow" : "block");
      resolve(result);
    } });
    emit("ArdiaCEF", "onPermission", { id, browserId: view.browserId, origin, permissions });
  });
}

export function resolvePermission(id: string, result: string, remember: boolean) {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  const answer: PermissionResult = result === "accept" || result === "deny" ? result : "dismiss";
  request.resolve(answer, remember);
}

export function dismissPermission(id: string) {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  request.resolve("dismiss", false);
  emit("ArdiaCEF", "onPermissionDismissed", { id });
}

export const pendingPermissions = () => [...pending.values()].map(({ id, origin, permissions }) => ({ id, origin, permissions }));
