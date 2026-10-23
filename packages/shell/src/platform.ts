export type HostPlatform = "macos" | "linux";

export const hostPlatform: HostPlatform =
  (globalThis as { __ARDIA_PLATFORM__?: HostPlatform }).__ARDIA_PLATFORM__ === "linux" ? "linux" : "macos";

export const isLinux = hostPlatform === "linux";
export const isMac = hostPlatform === "macos";
