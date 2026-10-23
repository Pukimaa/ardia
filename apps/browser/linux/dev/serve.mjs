#!/usr/bin/env node
// Usage: serve.mjs [--port <n>] [--out <dir>] [--no-build]
//   Builds Ardia's Linux UI with the mock engine (build-ui.mjs --testing) and serves it:
//   /            the host page (linux/dev/index.html): the mock engine, then the UI bundle
//   /e2e-pages/  the e2e suite's test pages (linux/dev/e2e/pages)
//   anything else from the build output
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const devDir = dirname(fileURLToPath(import.meta.url));
const linuxDir = resolve(devDir, "..");
const appDir = resolve(linuxDir, "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

if (args.includes("--help") || args.includes("-h")) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.filter((line, index) => line.startsWith("//") && lines.slice(0, index).every((l) => l.startsWith("//"))).map((line) => line.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}

const port = Number(option("--port", "8792"));
const outdir = resolve(option("--out", join(appDir, "build-linux/ui-mock")));
const pagesDir = join(devDir, "e2e", "pages");

if (!args.includes("--no-build")) {
  const build = spawnSync(process.execPath, [join(linuxDir, "scripts", "build-ui.mjs"), "--testing", "--no-minify", "--out", outdir], { stdio: "inherit", cwd: appDir });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const generated = readFileSync(join(outdir, "dev.html"), "utf8");
const scripts = [...generated.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
const stylesheet = /href="([^"]+\.css)"/.exec(generated)?.[1];
const engineScript = scripts.find((src) => src.includes("mock-engine"));
const uiScript = scripts.find((src) => src.includes("ardia-ui") && !src.includes("testing"));
if (!engineScript || !uiScript || !stylesheet) {
  console.error(`dev.html in ${outdir} does not load the mock engine and the UI bundle`);
  process.exit(1);
}

const hostPage = () =>
  readFileSync(join(devDir, "index.html"), "utf8")
    .replace('href="ardia-ui.css"', `href="${stylesheet}"`)
    .replace('src="mock-engine.js"', `src="${engineScript}"`)
    .replace('src="ardia-ui.js"', `src="${uiScript}"`);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};

const fileUnder = (root, path) => {
  const file = resolve(join(root, path));
  return file.startsWith(root) && existsSync(file) && statSync(file).isFile() ? file : null;
};

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const send = (status, type, body) => response.writeHead(status, { "content-type": type, "cache-control": "no-store" }).end(body);
  if (path === "/" || path === "/index.html" || path === "/dev.html") return send(200, contentTypes[".html"], hostPage());
  if (path.startsWith("/e2e-pages/")) {
    const file = fileUnder(pagesDir, path.slice("/e2e-pages/".length));
    if (file) return send(200, contentTypes[extname(file)] ?? "application/octet-stream", readFileSync(file));
    return send(404, "text/plain", "not found");
  }
  if (path === "/favicon.ico") return send(204, "image/x-icon", "");
  const file = fileUnder(outdir, path);
  if (!file) return send(404, "text/plain", "not found");
  send(200, contentTypes[extname(file)] ?? "application/octet-stream", readFileSync(file));
}).listen(port, "127.0.0.1", () => console.log(`Ardia mock engine: http://127.0.0.1:${port}/`));
