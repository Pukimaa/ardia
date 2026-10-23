# Ardia on Linux

Ardia on Linux is the same app on the same engine: ArdiaCore built from our Chromium 155 tree for Linux
(`target_os="linux"`, Ozone with Wayland and X11), with the same React app rendered in the engine itself.
Tabs are real Chrome tabs, composited by Chrome's own Viz like on the Mac; only the host of the app's UI changes.

## How it fits together

```
 ArdiaCore window (views::Widget, frameless, Ozone)
 ├── shell view: views::WebView of the shell WebContents (ardia://shell/), the React app via react-native-web
 └── tab views:  one views::WebView per shown tab, placed at the frame the shell reports for its <WebView>
```

- **The UI.** `apps/browser` is bundled for the web (`apps/browser/linux`): `react-native` resolves to
  `react-native-web`, `expo-modules-core` resolves to `apps/browser/linux/runtime/expoModules.ts`, and every
  native view manager the packages ask for (`ArdiaSymbol`, `ArdiaCEF`, `ArdiaWindowBackdrop`…) resolves to a
  web component registered in `apps/browser/linux/views`. The app's own source is unchanged except where Linux
  must differ (window controls, Ctrl for ⌘, the app menu), behind `isLinux` from `@ardia/shell`.
- **The bridge.** The shell page talks to the engine through `window.ardiaNative` (`apps/browser/linux/runtime/bridge.ts`).
  Calls are JSON over the `ardia-native://` scheme the browser process serves for the shell's origin only:
  `POST ardia-native://call/<Module>/<method>` with a JSON array of arguments answers `{"ok": value}` or
  `{"error": {"code", "message"}}`. Expo's `Function` (sync) calls use a synchronous XHR to the same URL; its
  `AsyncFunction` calls use `fetch`. Events go the other way as `window.__ardiaNativeEmit(module, event, payload)`
  and view events as `window.__ardiaNativeViewEmit(viewId, event, payload)`, run in the shell's main world.
  Module constants come with the page: `ardia-native://constants` answers `{ [module]: constants }`.
- **Native views.** A web view manager that needs the engine (the tab `WebView`, `Swipe`, file drop) gets a
  `viewId` from `ardiaNative.createView(manager, props)` and reports its frame in window coordinates with
  `updateView(viewId, {frame, props})` on every layout and prop change; its view methods are calls to
  `ardia-native://call/<manager>.view/<method>` with the `viewId` first. The engine places the tab's
  `views::WebView` at that frame, above the shell view, clipped by the `clip` rect the shell sends.
- **The engine.** `engine/ardiacore/src/ardia/core/linux` is ArdiaCore's Linux layer: the window
  (`ac_linux_window.*`), the bridge and its scheme (`ac_linux_bridge.*`), and one module per native module the
  app uses (`ac_linux_module_<name>.cc`), each a `LinuxNativeModule` (`ac_linux_bridge.h`). Chrome's services are
  the same `ac_*` engine calls as on the Mac (`engine/chromium`, portable C++), called directly.
- **What the Mac has that Linux maps.** Keychain → libsecret through Chrome's `os_crypt` (`ardia` key in the Secret
  Service, kwallet on KDE); NSMenu → `views::MenuRunner`; Metal shaders → WebGL2 (`apps/browser/linux/views/shaders`);
  Sparkle → the same appcast read by `ac_linux_module_app.cc`, installing the AppImage or telling a package
  manager install where the new package is; iCloud Drive sync → any folder the user picks (the sync format is a
  folder already); Dock → the desktop file and `org.freedesktop.Application`; EventKit → no calendar (the Live
  calendar card hides), Handoff, Apple Events and Dia's tab import → not on Linux.

## Building

- `scripts/linux/engine-build` builds ArdiaCore for Linux in `out/Release_GN_linux_x64` (or `_arm64`), with the
  same patches and the GN args in `scripts/linux/args.gn` (official, ThinLTO, PGO with Chromium's Linux profile,
  `proprietary_codecs`, VA-API).
- `pnpm -C apps/browser run linux:ui` bundles the UI into `apps/browser/build-linux/ui`.
- `scripts/linux/package` makes the AppImage, the `.deb`, the `.rpm` and the tarball from the engine build and the UI.

## Testing without the engine

`apps/browser/linux/dev` serves the UI with a mock `ardiaNative` (`mockEngine.ts`): tabs are iframes placed at
their `WebView` frames, documents live in memory, menus render in the page. `pnpm -C apps/browser run linux:e2e`
runs the Playwright suite against it in Chromium (`linux/dev/e2e`).
