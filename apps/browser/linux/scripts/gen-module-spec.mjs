#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const outFile = resolve(here, "../runtime/moduleSpec.generated.ts");

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith(".swift")) out.push(path);
  }
  return out;
};

export const swiftFiles = () => {
  const files = [];
  for (const pkg of readdirSync(join(repo, "packages"))) {
    const ios = join(repo, "packages", pkg, "ios");
    try {
      if (statSync(ios).isDirectory()) walk(ios, files);
    } catch {}
  }
  return files.sort();
};

const isIdentStart = (c) => /[A-Za-z_$]/.test(c);
const isIdent = (c) => /[A-Za-z0-9_$]/.test(c);

export function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;

  const readString = () => {
    let hashes = 0;
    while (src[i] === "#") {
      hashes++;
      i++;
    }
    const multiline = src.startsWith('"""', i);
    const quote = multiline ? '"""' : '"';
    i += quote.length;
    const close = quote + "#".repeat(hashes);
    const escape = "\\" + "#".repeat(hashes);
    let value = "";
    while (i < n) {
      if (src.startsWith(close, i)) {
        i += close.length;
        return value;
      }
      if (src.startsWith(escape, i)) {
        i += escape.length;
        if (src[i] === "(") {
          let depth = 0;
          while (i < n) {
            const c = src[i];
            if (c === '"' || (c === "#" && /^#+"/.test(src.slice(i, i + 8)))) {
              readString();
              continue;
            }
            if (c === "(") depth++;
            else if (c === ")") {
              depth--;
              if (depth === 0) {
                i++;
                break;
              }
            }
            i++;
          }
          value += "\u0000";
          continue;
        }
        value += src[i] ?? "";
        i++;
        continue;
      }
      if (!multiline && src[i] === "\n") return value;
      value += src[i];
      i++;
    }
    return value;
  };

  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    if (c === '"' || (c === "#" && /^#+"/.test(src.slice(i, i + 8)))) {
      tokens.push({ t: "str", v: readString() });
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdent(src[j])) j++;
      tokens.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "`") {
      const j = src.indexOf("`", i + 1);
      tokens.push({ t: "id", v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(src[j]) && !(src[j] === "." && !/[0-9]/.test(src[j + 1] ?? ""))) j++;
      tokens.push({ t: "num", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "-" && src[i + 1] === ">") {
      tokens.push({ t: "p", v: "->" });
      i += 2;
      continue;
    }
    tokens.push({ t: "p", v: c });
    i++;
  }
  return tokens;
}

const OPEN = { "(": ")", "{": "}", "[": "]" };

const matching = (tokens, start) => {
  const stack = [];
  for (let k = start; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.t !== "p") continue;
    if (OPEN[tok.v]) stack.push(OPEN[tok.v]);
    else if (tok.v === ")" || tok.v === "}" || tok.v === "]") {
      stack.pop();
      if (stack.length === 0) return k;
    }
  }
  return tokens.length - 1;
};

const splitArgs = (tokens, open, close) => {
  const args = [];
  let current = [];
  let depth = 0;
  for (let k = open + 1; k < close; k++) {
    const tok = tokens[k];
    if (tok.t === "p" && OPEN[tok.v]) depth++;
    else if (tok.t === "p" && (tok.v === ")" || tok.v === "}" || tok.v === "]")) depth--;
    if (depth === 0 && tok.t === "p" && tok.v === ",") {
      args.push(current);
      current = [];
    } else current.push(tok);
  }
  if (current.length) args.push(current);
  return args;
};

const closureArity = (tokens, open, close, viewMethod) => {
  let k = open + 1;
  if (tokens[k]?.t === "p" && tokens[k].v === "[") k = matching(tokens, k) + 1;
  let inAt = -1;
  let depth = 0;
  for (let m = k; m < close; m++) {
    const tok = tokens[m];
    if (tok.t === "p" && OPEN[tok.v]) depth++;
    else if (tok.t === "p" && (tok.v === ")" || tok.v === "}" || tok.v === "]")) depth--;
    else if (depth === 0 && tok.t === "id" && tok.v === "in") {
      inAt = m;
      break;
    }
    if (depth < 0) break;
  }
  if (inAt < 0) return 0;
  let params;
  if (tokens[k]?.t === "p" && tokens[k].v === "(") {
    const end = matching(tokens, k);
    params = splitArgs(tokens, k, end);
  } else {
    params = [];
    let current = [];
    for (let m = k; m < inAt; m++) {
      if (tokens[m].t === "p" && tokens[m].v === ",") {
        params.push(current);
        current = [];
      } else current.push(tokens[m]);
    }
    if (current.length) params.push(current);
  }
  const typeOf = (param) => {
    const colon = param.findIndex((tok) => tok.t === "p" && tok.v === ":");
    return colon < 0 ? null : param.slice(colon + 1).map((tok) => tok.v).join("");
  };
  let count = params.filter((param) => param.length && typeOf(param) !== "Promise").length;
  if (viewMethod && count > 0) count--;
  return count;
};

const stringArgs = (tokens, open, close) => {
  const values = [];
  for (const arg of splitArgs(tokens, open, close)) {
    if (arg.length === 1 && arg[0].t === "str") values.push(arg[0].v);
    else if (arg.length && arg[0].t === "p" && arg[0].v === "[") {
      for (const tok of arg) if (tok.t === "str") values.push(tok.v);
    } else values.push({ ref: arg.map((tok) => tok.v).join("") });
  }
  return values;
};

const dictionaryKeys = (tokens, open, close) => {
  const keys = [];
  let depth = 0;
  for (let k = open + 1; k < close; k++) {
    const tok = tokens[k];
    if (tok.t === "p" && OPEN[tok.v]) depth++;
    else if (tok.t === "p" && (tok.v === ")" || tok.v === "}" || tok.v === "]")) depth--;
    else if (depth === 1 && tok.t === "str" && tokens[k + 1]?.t === "p" && tokens[k + 1].v === ":") keys.push(tok.v);
  }
  return keys;
};

const staticArrays = (tokens, file, table) => {
  let typeName = null;
  const typeStack = [];
  let depth = 0;
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.t === "id" && /^(class|struct|enum|extension|actor)$/.test(tok.v) && tokens[k + 1]?.t === "id" && !/^(func|var|let|case)$/.test(tokens[k + 1].v)) {
      typeName = tokens[k + 1].v;
      let m = k + 2;
      while (m < tokens.length && !(tokens[m].t === "p" && (tokens[m].v === "{" || tokens[m].v === ";"))) m++;
      if (tokens[m]?.v === "{") {
        typeStack.push({ name: typeName, depth });
        depth++;
        k = m;
      }
      continue;
    }
    if (tok.t === "p" && tok.v === "{") depth++;
    else if (tok.t === "p" && tok.v === "}") {
      depth--;
      if (typeStack.length && typeStack[typeStack.length - 1].depth === depth) typeStack.pop();
    } else if (tok.t === "id" && (tok.v === "let" || tok.v === "var") && tokens[k - 1]?.v === "static" && typeStack.length) {
      const name = tokens[k + 1]?.v;
      let m = k + 2;
      if (tokens[m]?.v === ":") while (m < tokens.length && tokens[m].v !== "=") m++;
      if (tokens[m]?.v === "=" && tokens[m + 1]?.v === "[") {
        const end = matching(tokens, m + 1);
        const items = splitArgs(tokens, m + 1, end);
        if (items.every((item) => item.length === 1 && item[0].t === "str")) {
          table.set(`${typeStack[typeStack.length - 1].name}.${name}`, items.map((item) => item[0].v));
        }
      }
    }
  }
  return file;
};

const callAt = (tokens, k) => {
  const tok = tokens[k];
  if (tok.t !== "id") return null;
  const prev = tokens[k - 1];
  if (prev && prev.t === "p" && prev.v === ".") return null;
  const next = tokens[k + 1];
  if (!next || next.t !== "p") return null;
  let argsOpen = -1;
  let argsClose = -1;
  let m = k + 1;
  if (next.v === "(") {
    argsOpen = m;
    argsClose = matching(tokens, m);
    m = argsClose + 1;
  }
  let blockOpen = -1;
  let blockClose = -1;
  if (tokens[m]?.t === "p" && tokens[m].v === "{") {
    blockOpen = m;
    blockClose = matching(tokens, m);
    m = blockClose + 1;
  }
  if (argsOpen < 0 && blockOpen < 0) return null;
  while (tokens[m]?.t === "p" && tokens[m].v === "." && tokens[m + 1]?.t === "id" && tokens[m + 2]?.v === "(") {
    m = matching(tokens, m + 2) + 1;
  }
  return { name: tok.v, argsOpen, argsClose, blockOpen, blockClose, end: m };
};

const firstString = (tokens, call) => {
  if (call.argsOpen < 0) return null;
  const tok = tokens[call.argsOpen + 1];
  return tok?.t === "str" ? tok.v : null;
};

const statements = function* (tokens, open, close) {
  let k = open + 1;
  while (k < close) {
    const tok = tokens[k];
    if (tok.t === "p" && tok.v === "#") {
      k += 2;
      continue;
    }
    const call = callAt(tokens, k);
    if (call) {
      yield call;
      k = Math.max(call.end, k + 1);
      continue;
    }
    if (tok.t === "p" && OPEN[tok.v]) {
      k = matching(tokens, k) + 1;
      continue;
    }
    k++;
  }
};

const resolveRefs = (values, table, where) =>
  values.flatMap((value) => {
    if (typeof value === "string") return [value];
    const hit = table.get(value.ref) ?? [...table].find(([key]) => key.endsWith(`.${value.ref}`))?.[1];
    if (!hit) throw new Error(`${where}: cannot resolve ${value.ref}`);
    return hit;
  });

const parseBlock = (tokens, open, close, ctx, isView) => {
  const spec = { methods: {}, arity: {}, events: [], constants: [], props: [], view: null, didUpdateProps: false, name: null };
  for (const call of statements(tokens, open, close)) {
    switch (call.name) {
      case "Name":
        spec.name = firstString(tokens, call);
        break;
      case "Events":
        if (call.argsOpen >= 0) spec.events.push(...resolveRefs(stringArgs(tokens, call.argsOpen, call.argsClose), ctx.table, ctx.where));
        break;
      case "Constant":
      case "Property": {
        const key = firstString(tokens, call);
        if (key != null) spec.constants.push(key);
        break;
      }
      case "Constants": {
        const ranges = [];
        if (call.argsOpen >= 0) ranges.push([call.argsOpen, call.argsClose]);
        if (call.blockOpen >= 0) ranges.push([call.blockOpen, call.blockClose]);
        for (const [a, b] of ranges) {
          for (let k = a + 1; k < b; k++) {
            if (tokens[k].t === "p" && tokens[k].v === "[") {
              spec.constants.push(...dictionaryKeys(tokens, k, matching(tokens, k)));
              break;
            }
          }
        }
        break;
      }
      case "Function":
      case "AsyncFunction": {
        const name = firstString(tokens, call);
        if (name == null) break;
        spec.methods[name] = call.name === "Function" ? "sync" : "async";
        if (call.blockOpen >= 0) spec.arity[name] = closureArity(tokens, call.blockOpen, call.blockClose, isView);
        else {
          const args = call.argsOpen >= 0 ? splitArgs(tokens, call.argsOpen, call.argsClose) : [];
          spec.arity[name] = args.length > 1 ? -1 : 0;
        }
        break;
      }
      case "Prop": {
        const name = firstString(tokens, call);
        if (name != null) spec.props.push(name);
        break;
      }
      case "OnViewDidUpdateProps":
        spec.didUpdateProps = true;
        break;
      case "View":
        if (!isView && call.blockOpen >= 0) {
          const view = parseBlock(tokens, call.blockOpen, call.blockClose, ctx, true);
          spec.view = spec.view ? mergeView(spec.view, view) : view;
        } else if (!isView) spec.view = spec.view ?? parseBlock(tokens, 0, 0, ctx, true);
        break;
      default:
        break;
    }
  }
  return spec;
};

const mergeView = (a, b) => ({
  ...a,
  methods: { ...a.methods, ...b.methods },
  arity: { ...a.arity, ...b.arity },
  events: [...a.events, ...b.events],
  props: [...a.props, ...b.props],
  didUpdateProps: a.didUpdateProps || b.didUpdateProps,
});

const uniq = (list) => [...new Set(list)];

export function parseModules(files = swiftFiles()) {
  const table = new Map();
  const parsed = files.map((file) => {
    const tokens = tokenize(readFileSync(file, "utf8"));
    staticArrays(tokens, file, table);
    return { file, tokens };
  });
  const modules = {};
  for (const { file, tokens } of parsed) {
    for (let k = 0; k < tokens.length; k++) {
      if (!(tokens[k].t === "id" && tokens[k].v === "definition" && tokens[k - 1]?.v === "func")) continue;
      let m = k + 1;
      while (m < tokens.length && !(tokens[m].t === "p" && tokens[m].v === "{")) m++;
      if (!tokens.slice(k, m).some((tok) => tok.v === "ModuleDefinition")) continue;
      const close = matching(tokens, m);
      const where = file.slice(repo.length + 1);
      const spec = parseBlock(tokens, m, close, { table, where }, false);
      k = close;
      if (!spec.name) throw new Error(`${where}: module without Name`);
      if (modules[spec.name]) throw new Error(`${where}: duplicate module ${spec.name}`);
      const entry = {
        methods: spec.methods,
        arity: spec.arity,
        events: uniq(spec.events),
        constants: uniq(spec.constants),
        source: where,
      };
      if (spec.view) {
        entry.view = {
          props: uniq(spec.view.props),
          events: uniq(spec.view.events),
          methods: Object.keys(spec.view.methods),
          arity: spec.view.arity,
          didUpdateProps: spec.view.didUpdateProps,
        };
      }
      modules[spec.name] = entry;
    }
  }
  return Object.fromEntries(Object.keys(modules).sort().map((name) => [name, modules[name]]));
}

const q = (s) => JSON.stringify(s);
const list = (items) => `[${items.map(q).join(", ")}]`;
const record = (obj, indent) => {
  const keys = Object.keys(obj);
  if (!keys.length) return "{}";
  return `{\n${keys.map((key) => `${indent}  ${q(key)}: ${q(obj[key])},`).join("\n")}\n${indent}}`;
};

export function render(modules) {
  const lines = [];
  lines.push("export type ModuleMethodKind = \"sync\" | \"async\";");
  lines.push("");
  lines.push("export type ModuleViewSpec = {");
  lines.push("  props: string[];");
  lines.push("  events: string[];");
  lines.push("  methods: string[];");
  lines.push("  methodArity: Record<string, number>;");
  lines.push("  onViewDidUpdateProps: boolean;");
  lines.push("};");
  lines.push("");
  lines.push("export type ModuleSpec = {");
  lines.push("  methods: Record<string, ModuleMethodKind>;");
  lines.push("  methodArity: Record<string, number>;");
  lines.push("  events: string[];");
  lines.push("  constants: string[];");
  lines.push("  view?: ModuleViewSpec;");
  lines.push("};");
  lines.push("");
  lines.push("export const moduleSpec: Record<string, ModuleSpec> = {");
  for (const [name, spec] of Object.entries(modules)) {
    lines.push(`  ${q(name)}: {`);
    lines.push(`    methods: ${record(spec.methods, "    ")},`);
    lines.push(`    methodArity: ${record(spec.arity, "    ")},`);
    lines.push(`    events: ${list(spec.events)},`);
    lines.push(`    constants: ${list(spec.constants)},`);
    if (spec.view) {
      lines.push("    view: {");
      lines.push(`      props: ${list(spec.view.props)},`);
      lines.push(`      events: ${list(spec.view.events)},`);
      lines.push(`      methods: ${list(spec.view.methods)},`);
      lines.push(`      methodArity: ${record(spec.view.arity, "      ")},`);
      lines.push(`      onViewDidUpdateProps: ${spec.view.didUpdateProps},`);
      lines.push("    },");
    }
    lines.push("  },");
  }
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const started = performance.now();
  const modules = parseModules();
  const output = render(modules);
  const check = process.argv.includes("--check");
  if (check) {
    let current = "";
    try {
      current = readFileSync(outFile, "utf8");
    } catch {}
    if (current !== output) {
      console.error(`${outFile.slice(repo.length + 1)} is stale; run node apps/browser/linux/scripts/gen-module-spec.mjs`);
      process.exit(1);
    }
  } else writeFileSync(outFile, output);
  const count = Object.keys(modules).length;
  const methods = Object.values(modules).reduce((sum, spec) => sum + Object.keys(spec.methods).length, 0);
  console.log(`${count} modules, ${methods} methods in ${Math.round(performance.now() - started)} ms`);
}
