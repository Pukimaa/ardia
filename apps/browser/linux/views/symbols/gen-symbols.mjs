#!/usr/bin/env node
// Usage: gen-symbols.mjs [--lucide <dir>] [--material <dir>]
//   Writes symbols.generated.ts, the inline SVG glyphs that stand in for SF Symbols on Linux, from mapping.json.
//   Each entry of mapping.json is "l:<lucide name>" (stroked), "lf:<lucide name>" (stroked and filled),
//   "m:<material symbol>" or "mf:<material symbol>" (Material Symbols Rounded, outline or fill).
//   --lucide    an unpacked lucide-static package (default: fetched with npm pack at the pinned version)
//   --material  an unpacked @material-symbols/svg-400 package (default: fetched with npm pack at the pinned version)
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
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

const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const mapping = JSON.parse(readFileSync(join(here, "mapping.json"), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "ardia-symbols-"));

const unpack = (name, version) => {
  const tarball = execFileSync("npm", ["pack", `${name}@${version}`, "--silent", "--pack-destination", scratch], { encoding: "utf8" }).trim().split("\n").pop();
  const out = join(scratch, name.replace(/[@/]/g, "_"));
  execFileSync("mkdir", ["-p", out]);
  execFileSync("tar", ["xzf", join(scratch, tarball), "-C", out]);
  return join(out, "package");
};

const lucideDir = resolve(option("--lucide") ?? unpack("lucide-static", mapping.sources["lucide-static"]));
const materialDir = resolve(option("--material") ?? unpack("@material-symbols/svg-400", mapping.sources["@material-symbols/svg-400"]));

const lucideBody = (name) => {
  const svg = readFileSync(join(lucideDir, "icons", `${name}.svg`), "utf8");
  const inner = svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>"));
  return inner.replace(/<!--[\s\S]*?-->/g, "").replace(/\s*\n\s*/g, "").replace(/\s+\/>/g, "/>").trim();
};

const materialBody = (name, fill) => {
  const file = join(materialDir, "rounded", `${name}${fill ? "-fill" : ""}.svg`);
  const svg = readFileSync(file, "utf8");
  const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((match) => `<path d="${match[1]}"/>`);
  if (!paths.length) throw new Error(`No path in ${file}`);
  return paths.join("");
};

const entries = [];
for (const [symbol, spec] of Object.entries(mapping.symbols).sort(([a], [b]) => a.localeCompare(b))) {
  const [kind, name] = spec.split(":");
  const scale = mapping.scale?.[symbol] ?? 1;
  let glyph;
  if (kind === "l" || kind === "lf") glyph = { paint: kind === "lf" ? "strokeFill" : "stroke", viewBox: "0 0 24 24", body: lucideBody(name) };
  else if (kind === "m" || kind === "mf") glyph = { paint: "fill", viewBox: "0 -960 960 960", body: materialBody(name, kind === "mf") };
  else throw new Error(`Unknown source for ${symbol}: ${spec}`);
  if (scale !== 1) glyph.scale = scale;
  entries.push(`  ${JSON.stringify(symbol)}: ${JSON.stringify(glyph)},`);
}

const source = `export type SymbolPaint = "stroke" | "strokeFill" | "fill";

export type SymbolGlyph = { paint: SymbolPaint; viewBox: string; body: string; scale?: number };

export const symbolGlyphs: Record<string, SymbolGlyph> = {
${entries.join("\n")}
};

export const weakSymbolMatches: readonly string[] = ${JSON.stringify(mapping.weak ?? [])};
`;

writeFileSync(join(here, "symbols.generated.ts"), source);
if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
console.log(`Wrote ${entries.length} symbols to ${join(here, "symbols.generated.ts")}`);
