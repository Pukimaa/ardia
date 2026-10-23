import { createElement, forwardRef, useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { View } from "../../runtime/reactNative";
import { parseHex, splitProps, useDark, useDevicePixelRatio, useElementSize, useMergedRef, useWindowActive, type ViewProps } from "../common";
import { adjustLightness, grainUrl, oklab, paintArcGradient, parseThemeColors, type Vec4 } from "./color";
import { BACKDROP_FRAGMENT, createProgram, type Program } from "./gl";

const UNIFORMS = ["labA", "labB", "viewSize", "direction", "grainOpacity", "grainScale"] as const;

const INACTIVE_GRAIN = 0.25;

const MATERIAL_FILL = { dark: "rgb(47,44,43)", light: "rgb(239,237,236)" };

const layer: CSSProperties = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "none" };

const p3 = (c: [number, number, number], alpha: number) => `color(display-p3 ${c[0].toFixed(5)} ${c[1].toFixed(5)} ${c[2].toFixed(5)} / ${alpha.toFixed(4)})`;

function ThemeCanvas({ colors, opacity }: { colors: Vec4[]; opacity: number }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const host = useRef<HTMLElement | null>(null);
  const size = useElementSize(host);
  const ratio = useDevicePixelRatio(host);
  const key = JSON.stringify(colors);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || size.width === 0 || size.height === 0) return;
    element.width = Math.max(1, Math.round(size.width * ratio));
    element.height = Math.max(1, Math.round(size.height * ratio));
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, element.width, element.height);
    paintArcGradient(ctx, size.width, size.height, colors);
  }, [key, size.width, size.height, ratio]);
  return createElement(
    "div",
    { ref: host, style: { ...layer, opacity }, "data-backdrop-theme": "" },
    createElement("canvas", { ref: canvas, style: { ...layer, width: "100%", height: "100%" } }),
  );
}

export const WindowBackdrop = forwardRef<unknown, ViewProps>(function WindowBackdrop(props, ref) {
  const { own, rest } = splitProps("ArdiaWindowBackdrop", props);
  const host = useRef<HTMLElement | null>(null);
  const setRef = useMergedRef(ref, host);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const program = useRef<Program<(typeof UNIFORMS)[number]> | null>(null);
  const size = useElementSize(host);
  const ratio = useDevicePixelRatio(host);
  const active = useWindowActive(host);
  const vibrancy = own.vibrancy === true;

  const themeColors = parseThemeColors(own.themeColors);
  const custom = themeColors.length > 0;
  const appearance = custom && (own.themeAppearance === "dark" || own.themeAppearance === "light") ? own.themeAppearance === "dark" : null;
  const dark = useDark(appearance);

  const hex = Array.isArray(own.colors) ? own.colors.map(parseHex).filter((c): c is Vec4 => !!c) : [];
  const first = hex[0] ?? null;
  const labA = first ? oklab(first) : ([0.27, 0.02, 0, 1] as Vec4);
  const labB = first ? oklab(hex[hex.length - 1] ?? first) : ([0.23, 0.02, 0, 1] as Vec4);
  const radians = ((typeof own.angle === "number" ? own.angle : 180) * Math.PI) / 180;
  const grainOpacity = typeof own.grainOpacity === "number" ? own.grainOpacity : 0.1;
  const grainScale = typeof own.grainScale === "number" ? own.grainScale : 1;
  const uniformKey = JSON.stringify([labA, labB, radians, grainOpacity, grainScale]);

  useEffect(
    () => () => {
      program.current?.dispose();
      program.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    const element = canvas.current;
    if (vibrancy || !element || size.width === 0 || size.height === 0) return;
    if (!program.current) program.current = createProgram(element, BACKDROP_FRAGMENT, UNIFORMS);
    const current = program.current;
    if (!current) return;
    const { gl, uniforms } = current;
    gl.useProgram(current.program);
    gl.uniform4f(uniforms.labA, labA[0], labA[1], labA[2], labA[3]);
    gl.uniform4f(uniforms.labB, labB[0], labB[1], labB[2], labB[3]);
    gl.uniform2f(uniforms.viewSize, size.width, size.height);
    gl.uniform2f(uniforms.direction, Math.sin(radians), -Math.cos(radians));
    gl.uniform1f(uniforms.grainOpacity, grainOpacity);
    gl.uniform1f(uniforms.grainScale, grainScale);
    current.draw(Math.max(1, Math.round(size.width * ratio)), Math.max(1, Math.round(size.height * ratio)));
  }, [vibrancy, uniformKey, size.width, size.height, ratio]);

  let treatment: React.ReactNode = null;
  if (vibrancy) {
    const tint = parseHex(own.tintColor);
    const tintRGB: [number, number, number] = tint ? [tint[0], tint[1], tint[2]] : [0.5, 0.5, 0.5];
    const tintAlpha = typeof own.tintAlpha === "number" ? own.tintAlpha : 0.36;
    const lightness = typeof own.tintLightness === "number" ? own.tintLightness : 0.25;
    const themeOpacity = typeof own.themeOpacity === "number" ? own.themeOpacity : 1;
    const baseAlpha = typeof own.themeBaseAlpha === "number" ? own.themeBaseAlpha : 0;
    const grain = typeof own.themeGrain === "number" ? Math.min(Math.max(own.themeGrain, 0), 1) : 0;
    const texture = typeof own.themeTexture === "string" ? own.themeTexture : "grain";
    const base = custom ? (dark ? `rgba(0,0,0,${baseAlpha})` : `rgba(255,255,255,${baseAlpha})`) : dark ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.8)";
    treatment = createElement(
      "div",
      { style: layer, "data-backdrop-treatment": dark ? "dark" : "light" },
      createElement("div", { style: { ...layer, backgroundColor: dark ? MATERIAL_FILL.dark : MATERIAL_FILL.light } }),
      createElement("div", { style: { ...layer, backgroundColor: base } }),
      custom
        ? createElement(ThemeCanvas, { colors: themeColors, opacity: themeOpacity })
        : createElement("div", {
            style: {
              ...layer,
              opacity: dark ? 0.5 : 0.75,
              background: `linear-gradient(to bottom, ${p3(tintRGB, tintAlpha)}, ${p3(adjustLightness(tintRGB, lightness), tintAlpha)})`,
            },
          }),
      custom && grain > 0
        ? createElement("div", {
            style: {
              ...layer,
              opacity: grain * (active ? 1 : INACTIVE_GRAIN),
              backgroundImage: `url(${grainUrl(texture)})`,
              backgroundSize: "64px 64px",
            },
          })
        : null,
    );
  }

  return createElement(
    View,
    { ...rest, ref: setRef, pointerEvents: "none", dataSet: { ...(rest.dataSet as object), backdrop: vibrancy ? "vibrancy" : "gradient" } },
    treatment,
    createElement("canvas", { ref: canvas, style: { ...layer, width: "100%", height: "100%", visibility: vibrancy ? "hidden" : "visible" } }),
  );
});
