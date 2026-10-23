#!/usr/bin/env node
// Usage: build.mjs [--out <dir>] [--serve --port <n>]
//   Bundles the Linux view managers' gallery (views/gallery.html) against a fake ardiaNative that records every call.
//   --out    output directory (default apps/browser/build-linux/gallery-ui)
//   --serve  serve the output on --port (default 8795) until killed
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const viewsDir = resolve(here, "..");
const linuxDir = resolve(viewsDir, "..");
const appDir = resolve(linuxDir, "..");
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const header = [];
  for (const line of lines) {
    if (!line.startsWith("//")) break;
    header.push(line.replace(/^\/\/ ?/, ""));
  }
  console.log(header.join("\n"));
  process.exit(0);
}

const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const outdir = resolve(option("--out", join(appDir, "build-linux/gallery-ui")));
const port = Number(option("--port", "8795"));
const runtimeDir = join(linuxDir, "runtime");
const aliases = {
  "react-native": join(runtimeDir, "reactNative.tsx"),
  "expo-modules-core": join(runtimeDir, "expoModules.ts"),
};

mkdirSync(outdir, { recursive: true });
await esbuild.build({
  entryPoints: { gallery: join(here, "gallery.tsx") },
  outdir,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome130"],
  jsx: "automatic",
  sourcemap: true,
  logLevel: "warning",
  resolveExtensions: [".linux.tsx", ".linux.ts", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
  mainFields: ["browser", "module", "main"],
  tsconfig: join(viewsDir, "tsconfig.json"),
  define: { __DEV__: "false", "process.env.NODE_ENV": '"production"', "process.env.EXPO_OS": '"web"', global: "globalThis" },
  loader: { ".png": "dataurl", ".ttf": "file", ".mp3": "file", ".wav": "file", ".svg": "file" },
  plugins: [
    {
      name: "ardia-gallery",
      setup(build) {
        build.onResolve({ filter: /^(react-native|expo-modules-core)$/ }, (resolveArgs) => ({ path: aliases[resolveArgs.path] }));
      },
    },
  ],
});
copyFileSync(join(viewsDir, "gallery.html"), join(outdir, "gallery.html"));
console.log(`Built the views gallery into ${outdir}`);

if (args.includes("--serve")) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".map": "application/json", ".png": "image/png" };
  createServer((request, response) => {
    const path = resolve(join(outdir, decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname)));
    if (!path.startsWith(outdir) || !existsSync(path) || !statSync(path).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(readFileSync(path));
  }).listen(port, "127.0.0.1", () => console.log(`Serving the gallery on http://127.0.0.1:${port}/gallery.html`));
}
