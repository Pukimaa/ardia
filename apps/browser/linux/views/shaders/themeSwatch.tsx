import { createElement, forwardRef, useLayoutEffect, useRef } from "react";
import { View } from "../../runtime/reactNative";
import { splitProps, useDevicePixelRatio, useElementSize, useMergedRef, type ViewProps } from "../common";
import { padImage, paintArcGradient, paintGrain, parseThemeColors } from "./color";

export const ThemeSwatch = forwardRef<unknown, ViewProps>(function ThemeSwatch(props, ref) {
  const { own, rest } = splitProps("ArdiaThemeSwatch", props);
  const host = useRef<HTMLElement | null>(null);
  const setRef = useMergedRef(ref, host);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const size = useElementSize(host);
  const ratio = useDevicePixelRatio(host);
  const colors = parseThemeColors(own.colors);
  const grain = typeof own.grain === "number" ? Math.min(Math.max(own.grain, 0), 1) : 0;
  const texture = typeof own.texture === "string" ? own.texture : "grain";
  const padLightness = typeof own.padLightness === "number" ? own.padLightness : -1;
  const key = JSON.stringify([colors, grain, texture, padLightness]);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || size.width === 0 || size.height === 0) return;
    element.width = Math.max(1, Math.round(size.width * ratio));
    element.height = Math.max(1, Math.round(size.height * ratio));
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, element.width, element.height);
    paintArcGradient(ctx, size.width, size.height, colors);
    if (padLightness >= 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(padImage(padLightness), 0, 0, element.width, element.height);
    }
    paintGrain(ctx, texture, grain, ratio);
  }, [key, size.width, size.height, ratio]);

  return createElement(
    View,
    { ...rest, ref: setRef, pointerEvents: "none", dataSet: { ...(rest.dataSet as object), themeSwatch: "" } },
    createElement("canvas", { ref: canvas, style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none" } }),
  );
});
