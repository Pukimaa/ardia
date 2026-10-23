import { createElement, forwardRef, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ardiaNative } from "../runtime/bridge";
import { View } from "../runtime/reactNative";
import { cssHex, fire, parseHex, splitProps, SYSTEM_FONT, useDark, useElementSize, useLatest, useMergedRef, WEIGHTS, windowOf, type ViewProps } from "./common";
import { windowIdOf } from "./nativeViews";
import { symbolGlyphs } from "./symbols/symbols.generated";

const LABEL = ["rgba(0,0,0,0.85)", "rgba(255,255,255,0.85)"] as const;
const SECONDARY_LABEL = [
  [0, 0, 0, 0.5],
  [255, 255, 255, 0.55],
] as const;

const fill: CSSProperties = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "none" };

const styledDocuments = new WeakSet<Document>();

const DRAG_STYLE = `[data-ardia-drag-region="drag"]{-webkit-app-region:drag;app-region:drag}
[data-ardia-drag-region] *,[role="button"],[role="link"],[role="textbox"],[role="slider"],[role="switch"],[role="checkbox"],a,button,input,textarea,select,[contenteditable="true"]{-webkit-app-region:no-drag;app-region:no-drag}`;

function installDragStyle(doc: Document) {
  if (styledDocuments.has(doc)) return;
  styledDocuments.add(doc);
  const style = doc.createElement("style");
  style.dataset.ardiaDragRegions = "";
  style.textContent = DRAG_STYLE;
  doc.head.appendChild(style);
}

export const WindowDragRegion = forwardRef<unknown, ViewProps>(function WindowDragRegion(props, ref) {
  const { own, rest } = splitProps("ArdiaShell", props);
  const host = useRef<HTMLElement | null>(null);
  const setRef = useMergedRef(ref, host);
  const latest = useLatest(own);
  const titleBarDoubleClick = own.titleBarDoubleClick !== false;

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    installDragStyle(element.ownerDocument);
    element.dataset.ardiaDragRegion = titleBarDoubleClick ? "drag" : "press";
    if (titleBarDoubleClick) return;
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.target !== element) return;
      if (event.detail >= 2) {
        if (event.detail === 2) fire(latest.current.onRegionDoubleClick, "onRegionDoubleClick", {}, element);
        return;
      }
      const windowId = windowIdOf(element);
      if (windowId) void ardiaNative().call("ArdiaShell", "beginWindowDrag", [windowId]).catch(() => {});
    };
    element.addEventListener("mousedown", onMouseDown);
    return () => element.removeEventListener("mousedown", onMouseDown);
  }, [titleBarDoubleClick]);

  return createElement(View, { ...rest, ref: setRef });
});

export const OutsidePressArea = forwardRef<unknown, ViewProps>(function OutsidePressArea(props, ref) {
  const { own, rest } = splitProps("ArdiaOutsidePressArea", props);
  const host = useRef<HTMLElement | null>(null);
  const setRef = useMergedRef(ref, host);
  const latest = useLatest(own);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const win = windowOf(element);
    const shown = () => element.isConnected && (typeof element.checkVisibility !== "function" || element.checkVisibility({ visibilityProperty: true }));
    const onPointerDown = (event: PointerEvent) => {
      if (!shown()) return;
      const target = event.target as Node | null;
      if (target && element.contains(target)) return;
      fire(latest.current.onOutsidePress, "onOutsidePress", {}, element);
    };
    const onNativePress = (payload: unknown) => {
      if (!shown()) return;
      const press = (payload ?? {}) as { windowId?: unknown; x?: unknown; y?: unknown };
      const windowId = windowIdOf(element);
      if (windowId != null && press.windowId != null && String(press.windowId) !== windowId) return;
      if (typeof press.x === "number" && typeof press.y === "number") {
        const rect = element.getBoundingClientRect();
        if (press.x >= rect.left && press.x < rect.right && press.y >= rect.top && press.y < rect.bottom) return;
      }
      fire(latest.current.onOutsidePress, "onOutsidePress", {}, element);
    };
    win.document.addEventListener("pointerdown", onPointerDown, true);
    const nativePresses = ardiaNative().addListener("ArdiaViews", "onNativePress", onNativePress);
    return () => {
      win.document.removeEventListener("pointerdown", onPointerDown, true);
      nativePresses.remove();
    };
  }, []);

  return createElement(View, { ...rest, ref: setRef });
});

const handledMenus = new WeakSet<Event>();

export const ContextMenuArea = forwardRef<unknown, ViewProps>(function ContextMenuArea(props, ref) {
  const { own, rest } = splitProps("ArdiaContextMenuArea", props);
  const host = useRef<HTMLElement | null>(null);
  const setRef = useMergedRef(ref, host);
  const latest = useLatest(own);
  const capture = own.captureDescendants === true;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const open = (event: Event) => {
      if (handledMenus.has(event)) return;
      handledMenus.add(event);
      event.preventDefault();
      fire(latest.current.onContextMenu, "onContextMenu", {}, element);
    };
    const onContextMenu = (event: MouseEvent) => open(event);
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0 && event.ctrlKey && !event.metaKey) open(event);
    };
    element.addEventListener("contextmenu", onContextMenu, capture);
    element.addEventListener("mousedown", onMouseDown, capture);
    return () => {
      element.removeEventListener("contextmenu", onContextMenu, capture);
      element.removeEventListener("mousedown", onMouseDown, capture);
    };
  }, [capture]);

  return createElement(View, { ...rest, ref: setRef });
});

const TEXT_FIELD_INSET = 2;

export const FadeLabel = forwardRef<unknown, ViewProps>(function FadeLabel(props, ref) {
  const { own, rest } = splitProps("ArdiaFadeLabel", props);
  const dark = useDark();
  const host = useRef<HTMLElement | null>(null);
  const text = useRef<HTMLSpanElement | null>(null);
  const setRef = useMergedRef(ref, host);
  const size = useElementSize(host);
  const [textWidth, setTextWidth] = useState(0);
  const content = typeof own.text === "string" ? own.text : "";
  const fontSize = typeof own.fontSize === "number" ? own.fontSize : 13;
  const weight = WEIGHTS[String(own.weight ?? "regular")] ?? 400;
  const fadeWidth = typeof own.fadeWidth === "number" ? own.fadeWidth : 24;

  useLayoutEffect(() => {
    const span = text.current;
    if (!span) return;
    const width = span.getBoundingClientRect().width;
    setTextWidth((previous) => (previous === width ? previous : width));
  });

  const overflowing = size.width > 0 && textWidth > size.width + 0.5;
  const start = Math.max(0, 1 - fadeWidth / Math.max(size.width, 1));
  const mask = overflowing ? `linear-gradient(to right, #000 0, #000 ${(start * 100).toFixed(3)}%, transparent 100%)` : undefined;
  const style: CSSProperties = {
    ...fill,
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
    maskImage: mask,
    WebkitMaskImage: mask,
  };
  const label: CSSProperties = {
    whiteSpace: "pre",
    paddingLeft: TEXT_FIELD_INSET,
    paddingRight: TEXT_FIELD_INSET,
    flexShrink: 0,
    fontFamily: SYSTEM_FONT,
    fontSize,
    fontWeight: weight,
    fontVariantNumeric: "tabular-nums",
    lineHeight: "normal",
    color: cssHex(own.color) ?? LABEL[dark ? 1 : 0],
  };
  return createElement(
    View,
    { ...rest, ref: setRef, pointerEvents: "none", style: [{ overflow: "hidden" }, rest.style] },
    createElement("div", { style }, createElement("span", { ref: text, style: label }, content)),
  );
});

export const ActivitySpinner = forwardRef<unknown, ViewProps>(function ActivitySpinner(props, ref) {
  const { rest } = splitProps("ArdiaActivitySpinner", props);
  const dark = useDark();
  const host = useRef<HTMLElement | null>(null);
  const setRef = useMergedRef(ref, host);
  const { width, height } = useElementSize(host);
  const [r, g, b, a] = SECONDARY_LABEL[dark ? 1 : 0];
  const rx = Math.max(0, width / 2 - 1.25);
  const ry = Math.max(0, height / 2 - 1.25);
  const ellipse = (stroke: string, ring: boolean) =>
    createElement("ellipse", {
      cx: width / 2,
      cy: height / 2,
      rx,
      ry,
      fill: "none",
      stroke,
      strokeWidth: 1.5,
      pathLength: ring ? 1 : undefined,
      strokeDasharray: ring ? "0.72 1" : undefined,
      strokeLinecap: ring ? "round" : undefined,
      style: ring ? { transformBox: "view-box", transformOrigin: "50% 50%", animation: "ardia-activity-rotation 1.88s linear infinite" } : undefined,
    });
  return createElement(
    View,
    { ...rest, ref: setRef, pointerEvents: "none" },
    width > 0 && height > 0
      ? createElement(
          "svg",
          { width, height, style: { ...fill, overflow: "visible" }, "data-ardia-spinner": "" },
          createElement("style", null, "@keyframes ardia-activity-rotation{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}"),
          ellipse(`rgba(${r},${g},${b},0.18)`, false),
          ellipse(`rgba(${r},${g},${b},${a})`, true),
        )
      : null,
  );
});

const STROKE_WEIGHTS: Record<string, number> = { light: 1.45, regular: 1.75, medium: 1.95, semibold: 2.2, bold: 2.5 };
const FILL_STROKES: Record<string, number> = { light: 0, regular: 0, medium: 8, semibold: 18, bold: 30 };

export const Symbol = forwardRef<unknown, ViewProps>(function Symbol(props, ref) {
  const { own, rest } = splitProps("ArdiaSymbol", props);
  const dark = useDark();
  const name = typeof own.name === "string" ? own.name : "questionmark";
  const pointSize = typeof own.size === "number" ? own.size : 14;
  const weight = typeof own.weight === "string" && own.weight in STROKE_WEIGHTS ? own.weight : "regular";
  const glyph = symbolGlyphs[name];
  const color = parseHex(own.color) ? cssHex(own.color) : LABEL[dark ? 1 : 0];
  let image: React.ReactNode = null;
  if (glyph) {
    const box = pointSize * 1.25 * (glyph.scale ?? 1);
    const stroked = glyph.paint !== "fill";
    const fillStroke = FILL_STROKES[weight] ?? 0;
    image = createElement("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: glyph.viewBox,
      width: box,
      height: box,
      "data-symbol": name,
      style: { position: "absolute", left: "50%", top: "50%", width: box, height: box, marginLeft: -box / 2, marginTop: -box / 2, overflow: "visible", pointerEvents: "none", color },
      fill: stroked ? (glyph.paint === "strokeFill" ? "currentColor" : "none") : "currentColor",
      stroke: stroked ? "currentColor" : fillStroke > 0 ? "currentColor" : "none",
      strokeWidth: stroked ? STROKE_WEIGHTS[weight] : fillStroke,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      dangerouslySetInnerHTML: { __html: glyph.body },
    });
  }
  return createElement(View, { ...rest, ref, pointerEvents: "none", dataSet: { ...(rest.dataSet as object), symbol: name } }, image);
});

export const Surface = forwardRef<unknown, ViewProps>(function Surface(props, ref) {
  const { own, rest } = splitProps("ArdiaSurface", props);
  const radius = typeof own.cornerRadius === "number" ? own.cornerRadius : 0;
  const borderWidth = typeof own.borderWidth === "number" ? own.borderWidth : 0;
  const gradient = Array.isArray(own.borderColors) ? own.borderColors.map((hex) => cssHex(hex)).filter((c): c is string => !!c) : [];
  const useGradient = gradient.length >= 2 && borderWidth > 0;
  const shadowColor = parseHex(own.surfaceShadowColor);
  const shadowOpacity = typeof own.surfaceShadowOpacity === "number" ? own.surfaceShadowOpacity : 0;
  const shadowRadius = typeof own.surfaceShadowRadius === "number" ? own.surfaceShadowRadius : 0;
  const offset = Array.isArray(own.surfaceShadowOffset) && own.surfaceShadowOffset.length === 2 ? (own.surfaceShadowOffset as number[]) : [0, 0];
  const plate: CSSProperties = {
    ...fill,
    borderRadius: radius,
    backgroundColor: cssHex(own.fill),
    boxSizing: "border-box",
    border: !useGradient && borderWidth > 0 && parseHex(own.borderColor) ? `${borderWidth}px solid ${cssHex(own.borderColor)}` : undefined,
    boxShadow:
      shadowColor && shadowOpacity > 0 ? `${offset[0]}px ${offset[1]}px ${shadowRadius * 2}px ${cssColor(shadowColor, shadowOpacity)}` : undefined,
  };
  const ring: CSSProperties | null = useGradient
    ? {
        ...fill,
        borderRadius: radius,
        boxSizing: "border-box",
        padding: borderWidth,
        background: `linear-gradient(to bottom, ${gradient.join(", ")})`,
        mask: "linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)",
        WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
        WebkitMaskComposite: "xor",
      }
    : null;
  return createElement(
    View,
    { ...rest, ref },
    createElement("div", { style: plate, "data-surface-plate": "" }),
    ring ? createElement("div", { style: ring, "data-surface-ring": "" }) : null,
    rest.children as React.ReactNode,
  );
});

function cssColor(color: [number, number, number, number], alpha: number) {
  return `rgba(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)},${+(color[3] * alpha).toFixed(4)})`;
}

type Material = readonly [light: string, dark: string];

const MATERIALS: Record<string, Material> = {
  hudWindow: ["rgba(235,235,235,0.584)", "rgba(79,79,79,0.416)"],
  popover: ["rgba(246,246,246,0.72)", "rgba(50,50,50,0.62)"],
  menu: ["rgba(246,246,246,0.72)", "rgba(50,50,50,0.62)"],
  sidebar: ["rgba(232,232,232,0.62)", "rgba(42,42,42,0.6)"],
  headerView: ["rgba(242,242,242,0.8)", "rgba(48,48,48,0.8)"],
  titlebar: ["rgba(242,242,242,0.8)", "rgba(48,48,48,0.8)"],
  sheet: ["rgba(236,236,236,0.92)", "rgba(50,50,50,0.92)"],
  windowBackground: ["rgba(236,236,236,0.92)", "rgba(50,50,50,0.92)"],
  underWindowBackground: ["rgba(225,225,225,0.8)", "rgba(32,32,32,0.8)"],
  contentBackground: ["rgba(255,255,255,0.9)", "rgba(30,30,30,0.9)"],
  fullScreenUI: ["rgba(240,240,240,0.7)", "rgba(25,25,25,0.7)"],
  toolTip: ["rgba(250,250,250,0.9)", "rgba(44,44,44,0.9)"],
  selection: ["rgba(0,99,225,0.75)", "rgba(0,88,208,0.75)"],
};

export const materialFill = (name: string, dark: boolean) => (MATERIALS[name] ?? MATERIALS.hudWindow!)[dark ? 1 : 0];

const materialStyle = (name: string, dark: boolean, radius: number): CSSProperties => ({
  ...fill,
  borderRadius: radius,
  overflow: radius > 0 ? "hidden" : undefined,
  backgroundColor: materialFill(name, dark),
  backdropFilter: "blur(30px) saturate(1.8)",
  WebkitBackdropFilter: "blur(30px) saturate(1.8)",
});

export const VisualEffect = forwardRef<unknown, ViewProps>(function VisualEffect(props, ref) {
  const { own, rest } = splitProps("ArdiaVisualEffect", props);
  const dark = useDark();
  const material = typeof own.material === "string" ? own.material : "hudWindow";
  const radius = typeof own.cornerRadius === "number" ? own.cornerRadius : 0;
  return createElement(
    View,
    { ...rest, ref, pointerEvents: "none", dataSet: { ...(rest.dataSet as object), material, blending: own.blendingMode === "behindWindow" ? "behindWindow" : "withinWindow" } },
    createElement("div", { style: materialStyle(material, dark, radius) }),
    rest.children as React.ReactNode,
  );
});

export const GlassEffect = forwardRef<unknown, ViewProps>(function GlassEffect(props, ref) {
  const { own, rest } = splitProps("ArdiaGlassEffect", props);
  const dark = useDark(typeof own.dark === "boolean" ? own.dark : null);
  const radius = typeof own.cornerRadius === "number" ? own.cornerRadius : 0;
  const tint = cssHex(own.tint);
  return createElement(
    View,
    { ...rest, ref, pointerEvents: "none", dataSet: { ...(rest.dataSet as object), glass: own.glassStyle === "clear" ? "clear" : "regular" } },
    createElement("div", { style: materialStyle("sidebar", dark, radius) }, tint ? createElement("div", { style: { ...fill, backgroundColor: tint } }) : null),
    rest.children as React.ReactNode,
  );
});
