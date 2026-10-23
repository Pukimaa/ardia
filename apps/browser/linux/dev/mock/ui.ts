import { prefersDark } from "./core";

type MenuItem = {
  separator?: boolean;
  id?: string;
  title?: string;
  key?: string;
  modifiers?: string[];
  enabled?: boolean;
  checked?: boolean;
  swatch?: string;
  swatchDark?: string;
  children?: MenuItem[];
};

type Point = { x: number; y: number };

const lastPointer = new WeakMap<Window, Point>();
const tracked = new WeakSet<Window>();

export function trackPointer(win: Window) {
  if (tracked.has(win)) return;
  tracked.add(win);
  const note = (event: MouseEvent) => lastPointer.set(win, { x: event.clientX, y: event.clientY });
  win.document.addEventListener("pointerdown", note, true);
  win.document.addEventListener("contextmenu", note, true);
  win.document.addEventListener("pointermove", note, { capture: true, passive: true });
}

export function notePointer(win: Window, point: Point) {
  lastPointer.set(win, point);
}

const palette = (dark: boolean) =>
  dark
    ? { bg: "rgba(40,40,44,0.98)", fg: "#f2f2f4", dim: "rgba(242,242,244,0.45)", hover: "#3b6fe0", line: "rgba(255,255,255,0.1)", border: "rgba(255,255,255,0.14)" }
    : { bg: "rgba(250,250,251,0.98)", fg: "#1d1d1f", dim: "rgba(29,29,31,0.4)", hover: "#2f6ae6", line: "rgba(0,0,0,0.08)", border: "rgba(0,0,0,0.12)" };

const MODIFIER_LABELS: Record<string, string> = { control: "Ctrl+", option: "Alt+", shift: "Shift+", command: "Ctrl+" };

const shortcutLabel = (item: MenuItem) => {
  if (!item.key) return "";
  const mods = [...new Set((item.modifiers ?? ["command"]).map((m) => MODIFIER_LABELS[m] ?? ""))].join("");
  const key = item.key === "\r" ? "Enter" : item.key === "\t" ? "Tab" : item.key.toUpperCase();
  return mods + key;
};

let activeMenu: { close(value: string | null): void } | null = null;

export function closeActiveMenu() {
  activeMenu?.close(null);
}

export function showMenu(win: Window, items: MenuItem[]): Promise<string | null> {
  activeMenu?.close(null);
  const doc = win.document;
  const dark = prefersDark();
  const colors = palette(dark);
  const layer = doc.createElement("div");
  layer.dataset.ardiaMockMenu = "";
  Object.assign(layer.style, { position: "fixed", inset: "0", zIndex: "2147483646" });
  doc.body.appendChild(layer);

  return new Promise((resolve) => {
    let done = false;
    const panels: HTMLElement[] = [];
    const close = (value: string | null) => {
      if (done) return;
      done = true;
      activeMenu = null;
      layer.remove();
      doc.removeEventListener("keydown", onKey, true);
      win.removeEventListener("blur", onBlur);
      resolve(value);
    };
    activeMenu = { close };

    const closeFrom = (depth: number) => {
      while (panels.length > depth) panels.pop()?.remove();
    };

    const openPanel = (entries: MenuItem[], at: Point, depth: number) => {
      closeFrom(depth);
      const panel = doc.createElement("div");
      panel.setAttribute("role", "menu");
      panel.dataset.ardiaMockMenuPanel = String(depth);
      Object.assign(panel.style, {
        position: "fixed",
        minWidth: "200px",
        maxHeight: `${win.innerHeight - 16}px`,
        overflowY: "auto",
        padding: "5px",
        borderRadius: "8px",
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        font: "13px system-ui, sans-serif",
        userSelect: "none",
      });
      for (const entry of entries) {
        if (entry.separator) {
          const line = doc.createElement("div");
          Object.assign(line.style, { height: "1px", margin: "5px 8px", background: colors.line });
          panel.appendChild(line);
          continue;
        }
        const row = doc.createElement("div");
        const enabled = entry.enabled !== false;
        row.setAttribute("role", "menuitem");
        row.dataset.menuId = entry.id ?? "";
        row.setAttribute("aria-disabled", String(!enabled));
        Object.assign(row.style, {
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "4px 10px 4px 6px",
          borderRadius: "5px",
          color: enabled ? colors.fg : colors.dim,
          cursor: "default",
          whiteSpace: "nowrap",
        });
        const check = doc.createElement("span");
        check.textContent = entry.checked ? "✓" : "";
        Object.assign(check.style, { width: "14px", textAlign: "center", flex: "none" });
        row.appendChild(check);
        const swatch = dark ? (entry.swatchDark ?? entry.swatch) : entry.swatch;
        if (swatch) {
          const dot = doc.createElement("span");
          Object.assign(dot.style, { width: "10px", height: "10px", borderRadius: "5px", background: swatch, flex: "none" });
          row.appendChild(dot);
        }
        const title = doc.createElement("span");
        title.textContent = entry.title ?? "";
        title.style.flex = "1";
        row.appendChild(title);
        const hint = doc.createElement("span");
        hint.textContent = entry.children?.length ? "›" : shortcutLabel(entry);
        Object.assign(hint.style, { color: colors.dim, marginLeft: "18px" });
        row.appendChild(hint);
        row.addEventListener("pointerenter", () => {
          for (const sibling of panel.children) (sibling as HTMLElement).style.background = "";
          if (!enabled) return closeFrom(depth + 1);
          row.style.background = colors.hover;
          row.style.color = "#fff";
          if (entry.children?.length) {
            const rect = row.getBoundingClientRect();
            openPanel(entry.children, { x: rect.right + 2, y: rect.top - 5 }, depth + 1);
          } else closeFrom(depth + 1);
        });
        row.addEventListener("pointerleave", () => {
          if (panels[depth + 1] && entry.children?.length) return;
          row.style.background = "";
          row.style.color = enabled ? colors.fg : colors.dim;
        });
        row.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!enabled || entry.children?.length) return;
          close(entry.id ?? null);
        });
        panel.appendChild(row);
      }
      layer.appendChild(panel);
      panels.push(panel);
      const rect = panel.getBoundingClientRect();
      const x = Math.max(4, Math.min(at.x, win.innerWidth - rect.width - 4));
      const y = Math.max(4, Math.min(at.y, win.innerHeight - rect.height - 4));
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(null);
    };
    const onBlur = () => close(null);
    layer.addEventListener("pointerdown", (event) => {
      if (event.target === layer) close(null);
    });
    layer.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (event.target === layer) close(null);
    });
    doc.addEventListener("keydown", onKey, true);
    win.addEventListener("blur", onBlur);
    openPanel(items, lastPointer.get(win) ?? { x: win.innerWidth / 2 - 100, y: 80 }, 0);
  });
}

type DialogSpec = {
  title: string;
  message?: string;
  confirmTitle?: string;
  cancelTitle?: string;
  destructive?: boolean;
  suppression?: string;
  input?: { value?: string; placeholder?: string };
};

export type DialogResult = { confirmed: boolean; suppressed: boolean; value: string | null };

export function showDialog(win: Window, spec: DialogSpec): Promise<DialogResult> {
  const doc = win.document;
  const colors = palette(prefersDark());
  const layer = doc.createElement("div");
  layer.dataset.ardiaMockDialog = "";
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    background: "rgba(0,0,0,0.18)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: "12vh",
    font: "13px system-ui, sans-serif",
  });
  const box = doc.createElement("div");
  box.setAttribute("role", "dialog");
  Object.assign(box.style, {
    width: "320px",
    padding: "18px",
    borderRadius: "12px",
    background: colors.bg,
    color: colors.fg,
    border: `1px solid ${colors.border}`,
    boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
  });
  const heading = doc.createElement("div");
  heading.textContent = spec.title;
  Object.assign(heading.style, { fontWeight: "600", fontSize: "14px", marginBottom: "6px" });
  box.appendChild(heading);
  if (spec.message) {
    const message = doc.createElement("div");
    message.textContent = spec.message;
    Object.assign(message.style, { color: colors.dim, marginBottom: "12px", lineHeight: "1.4" });
    box.appendChild(message);
  }
  let field: HTMLInputElement | null = null;
  if (spec.input) {
    field = doc.createElement("input");
    field.value = spec.input.value ?? "";
    field.placeholder = spec.input.placeholder ?? "";
    Object.assign(field.style, { width: "100%", boxSizing: "border-box", padding: "6px 8px", margin: "4px 0 12px", borderRadius: "6px", border: `1px solid ${colors.border}`, background: "transparent", color: colors.fg });
    box.appendChild(field);
  }
  let suppress: HTMLInputElement | null = null;
  if (spec.suppression) {
    const label = doc.createElement("label");
    Object.assign(label.style, { display: "flex", gap: "6px", alignItems: "center", marginBottom: "12px" });
    suppress = doc.createElement("input");
    suppress.type = "checkbox";
    label.append(suppress, doc.createTextNode(spec.suppression));
    box.appendChild(label);
  }
  const buttons = doc.createElement("div");
  Object.assign(buttons.style, { display: "flex", justifyContent: "flex-end", gap: "8px" });
  const button = (text: string, primary: boolean) => {
    const element = doc.createElement("button");
    element.textContent = text;
    Object.assign(element.style, {
      padding: "5px 14px",
      borderRadius: "6px",
      border: primary ? "none" : `1px solid ${colors.border}`,
      background: primary ? (spec.destructive ? "#d93a35" : colors.hover) : "transparent",
      color: primary ? "#fff" : colors.fg,
      font: "inherit",
    });
    buttons.appendChild(element);
    return element;
  };
  const cancel = button(spec.cancelTitle ?? "Cancel", false);
  const ok = button(spec.confirmTitle ?? "OK", true);
  box.appendChild(buttons);
  layer.appendChild(box);
  doc.body.appendChild(layer);
  (field ?? ok).focus();

  return new Promise((resolve) => {
    const finish = (confirmed: boolean) => {
      layer.remove();
      resolve({ confirmed, suppressed: !!suppress?.checked, value: confirmed && field ? field.value : null });
    };
    ok.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));
    layer.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(false);
      if (event.key === "Enter") finish(true);
    });
  });
}
