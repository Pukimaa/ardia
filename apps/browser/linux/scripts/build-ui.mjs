#!/usr/bin/env node
// Usage: build-ui.mjs [--dev] [--testing] [--port <n>] [--out <dir>]
//   Bundles Ardia's UI for Linux into apps/browser/build-linux/ui (minified, sourcemaps, hashed assets).
//   --dev      serve on --port (default 8790) and rebuild on change, with the testing pages
//   --testing  also emit testing.html, which runs the app against the stub engine (runtime/testing/stubNative.ts)
//   --out      write somewhere other than build-linux/ui
//   --no-minify  keep the bundle readable
//   --serve    after building, serve the output on --port until killed
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const linuxDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = resolve(linuxDir, "..");
const require = (await import("node:module")).createRequire(join(appDir, "package.json"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

if (flag("--help") || flag("-h")) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.filter((line, index) => line.startsWith("//") && lines.slice(0, index).every((l) => l.startsWith("//"))).map((line) => line.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}

const dev = flag("--dev");
const testing = dev || flag("--testing");
const port = Number(option("--port", "8790"));
const outdir = resolve(option("--out", join(appDir, dev ? "build-linux/ui-dev" : "build-linux/ui")));

const rnwDir = dirname(require.resolve("react-native-web/package.json"));
const runtimeDir = join(linuxDir, "runtime");
const viewsEntry = ["index.tsx", "index.ts"].map((name) => join(linuxDir, "views", name)).find(existsSync);
const mockEngine = join(linuxDir, "dev", "mockEngine.ts");

const aliases = {
  "react-native": join(runtimeDir, "reactNative.tsx"),
  "react-native/Libraries/Animated/useAnimatedProps": join(rnwDir, "dist/vendor/react-native/Animated/useAnimatedProps.js"),
  "expo-modules-core": join(runtimeDir, "expoModules.ts"),
};

const rnwPatches = {
  "modules/useResponderEvents/ResponderSystem.js": [
    [
      `  if (canUseDOM && window.__reactResponderSystemActive == null) {
    window.addEventListener('blur', eventListener);
    documentEventsBubblePhase.forEach(eventType => {
      document.addEventListener(eventType, eventListener);
    });
    documentEventsCapturePhase.forEach(eventType => {
      document.addEventListener(eventType, eventListener, true);
    });
    window.__reactResponderSystemActive = true;
  }`,
      `  if (canUseDOM && globalThis.__reactResponderSystemActive == null) {
    globalThis.__reactResponderSystemActive = true;
    globalThis.__ardiaEachWindow(win => {
      win.addEventListener('blur', eventListener);
      documentEventsBubblePhase.forEach(eventType => {
        win.document.addEventListener(eventType, eventListener);
      });
      documentEventsCapturePhase.forEach(eventType => {
        win.document.addEventListener(eventType, eventListener, true);
      });
    });
  }`,
    ],
    ["eventType === 'blur' && eventTarget === window ||", "eventType === 'blur' && eventTarget != null && eventTarget.window === eventTarget ||"],
  ],
  "modules/useResponderEvents/utils.js": [["window.getSelection()", "globalThis.__ardiaCurrentWindow().getSelection()"]],
  "modules/isSelectionValid/index.js": [["window.getSelection()", "globalThis.__ardiaCurrentWindow().getSelection()"]],
  "modules/modality/index.js": [
    [/if \(canUseDOM\) \{\n  \/\/ Window events\n([\s\S]*?)\n\}\nfunction callListeners/, (_match, body) =>
      `if (canUseDOM) {\n  globalThis.__ardiaEachWindow(win => {\n${body
        .replace(/addEventListener\(window, /g, "addEventListener(win, ")
        .replace(/addEventListener\(document, /g, "addEventListener(win.document, ")}\n  });\n}\nfunction callListeners`],
  ],
  "modules/useElementLayout/index.js": [
    ["var resizeObserver = null;", "var resizeObserver = null;\nvar resizeObservers = new WeakMap();"],
    ["function getResizeObserver() {", "function getResizeObserver(win) {\n  resizeObserver = resizeObservers.get(win) || null;"],
    ["typeof window.ResizeObserver !== 'undefined'", "typeof win.ResizeObserver !== 'undefined'"],
    ["resizeObserver = new window.ResizeObserver(", "resizeObserver = new win.ResizeObserver("],
    ["  return resizeObserver;\n}", "  if (resizeObserver != null) resizeObservers.set(win, resizeObserver);\n  return resizeObserver;\n}\nvar windowOf = node => node.ownerDocument && node.ownerDocument.defaultView || window;\nvar layoutObserver = {\n  observe: node => { var observer = getResizeObserver(windowOf(node)); if (observer != null) observer.observe(node); },\n  unobserve: node => { var observer = getResizeObserver(windowOf(node)); if (observer != null) observer.unobserve(node); }\n};"],
    ["var observer = getResizeObserver();", "var observer = layoutObserver;"],
  ],
  "modules/TextInputState/index.js": [[/document\.activeElement/g, "globalThis.__ardiaActiveElement()"]],
  "exports/TextInput/index.js": [[/document\.activeElement/g, "globalThis.__ardiaActiveElement()"]],
  "modules/usePressEvents/PressResponder.js": [
    ["document.removeEventListener('keyup', keyupHandler);", "globalThis.__ardiaLiveWindows().forEach(win => win.document.removeEventListener('keyup', keyupHandler));"],
    ["document.addEventListener('keyup', keyupHandler);", "globalThis.__ardiaLiveWindows().forEach(win => win.document.addEventListener('keyup', keyupHandler));"],
  ],
  "exports/Dimensions/index.js": [
    ["  var win = window;\n", "  var win = globalThis.__ardiaCurrentWindow();\n"],
    [
      /if \(canUseDOM\) \{\n  if \(window\.visualViewport\) \{[\s\S]*?\n  \}\n\}/,
      "if (canUseDOM) {\n  globalThis.__ardiaEachWindow(win => {\n    win.addEventListener('resize', handleResize, false);\n    win.addEventListener('focus', handleResize, false);\n  });\n}",
    ],
  ],
  "modules/forwardedProps/index.js": [
    ["  nativeID: true\n};", "  nativeID: true,\n  title: true,\n  draggable: true\n};"],
    ["  onClick: true,\n", "  onClick: true,\n  onDoubleClick: true,\n  onDragEnter: true,\n  onDragOver: true,\n  onDragLeave: true,\n  onDrop: true,\n"],
  ],
  "vendor/react-native/Animated/NativeAnimatedHelper.js": [["var _warnedMissingNativeAnimated = false;", "var _warnedMissingNativeAnimated = true;"]],
  "vendor/react-native/Animated/nodes/AnimatedValue.js": [["if (config && config.useNativeDriver) {", "if (false) {"]],
  "vendor/react-native/Animated/nodes/AnimatedColor.js": [["if (this.nativeColor || config && config.useNativeDriver) {", "if (this.nativeColor) {"]],
  "exports/StyleSheet/compiler/createReactDOMStyle.js": [
    ["var MONOSPACE_FONT_STACK = 'monospace,monospace';", `var MONOSPACE_FONT_STACK = 'Menlo,"SF Mono","JetBrains Mono","DejaVu Sans Mono","Liberation Mono",monospace';`],
    [
      `var SYSTEM_FONT_STACK = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';`,
      `var SYSTEM_FONT_STACK = 'system-ui,-apple-system,BlinkMacSystemFont,Inter,Cantarell,Ubuntu,"Noto Sans","DejaVu Sans",sans-serif';`,
    ],
    ["} else if (value === 'monospace') {", "} else if (value === 'monospace' || value === 'Menlo' || value === 'SF Mono') {"],
  ],
};

const applyPatches = (file, source, patches) => {
  let out = source;
  for (const [from, to] of patches) {
    const found = typeof from === "string" ? out.includes(from) : from.test(out);
    if (!found) throw new Error(`react-native-web changed: ${relative(rnwDir, file)} no longer has ${String(from).slice(0, 80)}`);
    if (from instanceof RegExp) from.lastIndex = 0;
    out = typeof from === "string" ? out.split(from).join(to) : out.replace(from, to);
  }
  return out;
};

const pngSize = (file) => {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

const contentHash = (buffers) => {
  const hash = createHash("sha256");
  for (const buffer of buffers) hash.update(buffer);
  return hash.digest("hex").slice(0, 10);
};

const ardiaLinuxPlugin = {
  name: "ardia-linux",
  setup(build) {
    build.onResolve({ filter: /^(react-native|expo-modules-core|react-native\/Libraries\/Animated\/useAnimatedProps)$/ }, (args) => ({
      path: aliases[args.path],
    }));
    build.onResolve({ filter: /^react-native\// }, (args) => ({
      errors: [{ text: `${args.path} has no Linux mapping (apps/browser/linux/scripts/build-ui.mjs)` }],
    }));
    build.onResolve({ filter: /^ardia-linux:views$/ }, () =>
      viewsEntry ? { path: viewsEntry } : { path: "ardia-linux:views", namespace: "ardia-empty" },
    );
    build.onLoad({ filter: /.*/, namespace: "ardia-empty" }, () => ({ contents: "", loader: "js" }));

    build.onLoad({ filter: /react-native-web[\\/]dist[\\/].*\.js$/ }, (args) => {
      const key = relative(join(rnwDir, "dist"), args.path).split("\\").join("/");
      const patches = rnwPatches[key];
      if (!patches) return undefined;
      return { contents: applyPatches(args.path, readFileSync(args.path, "utf8"), patches), loader: "js", resolveDir: dirname(args.path) };
    });

    build.onLoad({ filter: /\.(png|jpe?g|gif|webp)$/ }, (args) => {
      const ext = extname(args.path);
      const name = basename(args.path, ext).replace(/@\dx$/, "");
      const dir = dirname(args.path);
      const scales = [1, 2, 3].filter((scale) => existsSync(join(dir, scale === 1 ? `${name}${ext}` : `${name}@${scale}x${ext}`)));
      const variant = (scale) => join(dir, scale === 1 ? `${name}${ext}` : `${name}@${scale}x${ext}`);
      const hash = contentHash(scales.map((scale) => readFileSync(variant(scale))));
      const hashedName = `${name}-${hash}`;
      mkdirSync(join(outdir, "assets"), { recursive: true });
      for (const scale of scales) {
        const suffix = scale === 1 ? "" : `@${scale}x`;
        writeFileSync(join(outdir, "assets", `${hashedName}${suffix}${ext}`), readFileSync(variant(scale)));
      }
      const base = variant(scales[0]);
      const size = ext === ".png" ? pngSize(base) : { width: undefined, height: undefined };
      const divisor = scales[0];
      const asset = {
        __packager_asset: true,
        httpServerLocation: "assets",
        name: hashedName,
        type: ext.slice(1),
        scales,
        hash,
        width: size.width && size.width / divisor,
        height: size.height && size.height / divisor,
      };
      return {
        contents: `const { registerAsset } = require("react-native-web/dist/modules/AssetRegistry");\nmodule.exports = registerAsset(${JSON.stringify(asset)});\n`,
        loader: "js",
        resolveDir: appDir,
        watchFiles: scales.map(variant),
      };
    });
  },
};

const entryPoints = { "ardia-ui": join(linuxDir, "entry.tsx"), "ardia-ui-style": join(linuxDir, "window.css") };
if (testing) {
  entryPoints["testing/stub-native"] = join(runtimeDir, "testing", "stubNative.ts");
  entryPoints["testing/ardia-ui-testing"] = join(runtimeDir, "testing", "entry.tsx");
}
if (testing && existsSync(mockEngine)) entryPoints["dev/mock-engine"] = mockEngine;

const options = {
  entryPoints,
  outdir,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome130"],
  jsx: "automatic",
  minify: !dev && !flag("--no-minify"),
  sourcemap: true,
  metafile: true,
  legalComments: "linked",
  entryNames: dev ? "[dir]/[name]" : "[dir]/[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
  chunkNames: "chunks/[name]-[hash]",
  resolveExtensions: [".linux.tsx", ".linux.ts", ".linux.js", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".json"],
  mainFields: ["browser", "module", "main"],
  conditions: ["browser", "import", "default"],
  tsconfig: join(linuxDir, "tsconfig.json"),
  loader: { ".ttf": "file", ".otf": "file", ".woff": "file", ".woff2": "file", ".mp3": "file", ".wav": "file", ".svg": "file" },
  define: {
    __DEV__: dev ? "true" : "false",
    "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
    "process.env.EXPO_OS": JSON.stringify("web"),
    global: "globalThis",
  },
  banner: dev ? { js: `new EventSource("/esbuild").addEventListener("change", () => location.reload());` } : undefined,
  logLevel: "warning",
  plugins: [ardiaLinuxPlugin],
};

const outputFor = (metafile, entry) => {
  for (const [file, output] of Object.entries(metafile.outputs)) {
    if (output.entryPoint && resolve(output.entryPoint) === resolve(entry) && !file.endsWith(".map")) {
      if (entry.endsWith(".css") ? file.endsWith(".css") : file.endsWith(".js")) return relative(outdir, resolve(file)).split("\\").join("/");
    }
  }
  throw new Error(`No output for ${entry}`);
};

const writePages = (metafile) => {
  const ui = outputFor(metafile, entryPoints["ardia-ui"]);
  const css = outputFor(metafile, entryPoints["ardia-ui-style"]);
  const ready = readFileSync(join(linuxDir, "window-ready.js"));
  const readyName = dev ? "window-ready.js" : `window-ready-${contentHash([ready])}.js`;
  writeFileSync(join(outdir, readyName), ready);
  const page = (file) =>
    readFileSync(join(linuxDir, file), "utf8").replace('href="ardia-ui.css"', `href="${css}"`).replace('src="ardia-ui.js"', `src="${ui}"`).replace('src="window-ready.js"', `src="${readyName}"`);
  writeFileSync(join(outdir, "index.html"), page("index.html"));
  writeFileSync(join(outdir, "window.html"), page("window.html"));
  if (testing) {
    const stub = outputFor(metafile, entryPoints["testing/stub-native"]);
    const testingUi = outputFor(metafile, entryPoints["testing/ardia-ui-testing"]);
    writeFileSync(join(outdir, "testing.html"), page("index.html").replace(`<script src="${ui}">`, `<script src="${stub}"></script>\n    <script src="${testingUi}">`));
  }
  if (entryPoints["dev/mock-engine"]) {
    const engine = outputFor(metafile, entryPoints["dev/mock-engine"]);
    writeFileSync(join(outdir, "dev.html"), page("index.html").replace(`<script src="${ui}">`, `<script src="${engine}"></script>\n    <script src="${ui}">`));
  }
};

const pagesPlugin = {
  name: "ardia-linux-pages",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length === 0 && result.metafile) writePages(result.metafile);
    });
  },
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(root, listenPort) {
  createServer((request, response) => {
    const path = resolve(join(root, decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname)));
    if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": contentTypes[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(readFileSync(path));
  }).listen(listenPort, "127.0.0.1", () => console.log(`Serving ${relative(process.cwd(), root)} on http://127.0.0.1:${listenPort}/`));
}

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

if (dev) {
  const context = await esbuild.context({ ...options, plugins: [...options.plugins, pagesPlugin] });
  await context.watch();
  const { hosts, port: actualPort } = await context.serve({ servedir: outdir, port });
  console.log(`Ardia Linux UI: http://${hosts[0] ?? "127.0.0.1"}:${actualPort}/testing.html`);
} else {
  const started = performance.now();
  const result = await esbuild.build(options);
  writePages(result.metafile);
  writeFileSync(`${outdir}.meta.json`, JSON.stringify(result.metafile));
  const bytes = Object.entries(result.metafile.outputs)
    .filter(([file]) => file.endsWith(".js"))
    .reduce((sum, [, output]) => sum + output.bytes, 0);
  console.log(`Built ${relative(process.cwd(), outdir)} in ${Math.round(performance.now() - started)} ms (${(bytes / 1024).toFixed(0)} KiB of JS)`);
  if (flag("--serve")) serveStatic(outdir, port);
}
