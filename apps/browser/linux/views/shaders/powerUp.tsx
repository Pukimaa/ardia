import { createElement, forwardRef, useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { View } from "../../runtime/reactNative";
import { parseHex, prefersReducedMotion, splitProps, useDark, useDevicePixelRatio, useElementSize, useLatest, useMergedRef, windowOf, type ViewProps } from "../common";
import { oklab, type Vec4 } from "./color";
import { createProgram, HALO_FRAGMENT, MAX_POWER_UP_COLORS, POWER_UP_FRAGMENT, type Program } from "./gl";

export const PALETTES: Record<string, string[]> = {
  pink: ["#FF6AFF", "#FE8097", "#FF9966", "#FCE0FF", "#FA62B1"],
  purple: ["#7293FF", "#7D5DFF", "#E263FF", "#FF81EE", "#A585FF"],
  red: ["#FD3131", "#FA607C", "#FDA733", "#FFEBC9", "#F55F5D"],
  orange: ["#FFBB62", "#FE8026", "#FF7C5F", "#FFFCBE", "#FF9D00"],
  yellow: ["#FFD11A", "#FFE23E", "#FFA144", "#F8FFB5", "#FFE30A"],
  green: ["#90CE01", "#43CC60", "#0CD9EB", "#C3EEAF", "#9EDD73"],
  blue: ["#4ACCFF", "#5FADFF", "#60F0CF", "#9CEEFF", "#72C1FF"],
  default: ["#7E1731", "#334CB4", "#2D81FF", "#2D81FF", "#FFF268", "#F70305", "#FE64CD"],
};

const POWER_UP_UNIFORMS = ["direction", "numberOfColors", "colors", "time", "speed", "delay", "fadeOutStart", "fadeOutDuration", "origin"] as const;
const HALO_UNIFORMS = ["resolution", "direction", "colors", "isDark", "time", "speed", "delay", "fadeOutStart", "fadeOutDuration", "inset", "cornerRadius"] as const;

const POWER_UP_FINISH = 3.75;
const HALO_FINISH = 2;
const HALO_INSET = 50;
const MAX_STEP = 0.1;

const layer: CSSProperties = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "none" };

export function paletteColors(value: unknown): Vec4[] {
  const names = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const hexes = names.length === 1 && PALETTES[names[0]!] ? PALETTES[names[0]!]! : names;
  const colors = hexes.map(parseHex).filter((c): c is Vec4 => !!c);
  return colors.length ? colors : PALETTES.pink!.map((hex) => parseHex(hex)!);
}

type Clock = { time: number; last: number | null; frame: number };

function useAnimatedCanvas<U extends string>(
  canvas: React.RefObject<HTMLCanvasElement | null>,
  fragment: string,
  names: readonly U[],
  finish: number,
  restartKey: unknown,
  configure: (program: Program<U>, time: number) => void,
  size: { width: number; height: number },
  ratio: number,
) {
  const program = useRef<Program<U> | null>(null);
  const clock = useRef<Clock>({ time: 0, last: null, frame: 0 });
  const configureRef = useLatest(configure);
  const sizeRef = useLatest({ ...size, ratio });

  const render = () => {
    const element = canvas.current;
    const current = program.current;
    const { width, height, ratio: scale } = sizeRef.current;
    if (!element || !current || width === 0 || height === 0) return;
    configureRef.current(current, clock.current.time);
    current.draw(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const win = windowOf(element);
    const state = clock.current;
    state.time = 0;
    state.last = null;
    if (prefersReducedMotion(element)) return;
    if (!program.current) program.current = createProgram(element, fragment, names);
    if (!program.current) return;
    const tick = (now: number) => {
      state.frame = 0;
      if (state.last != null) state.time += Math.min(MAX_STEP, Math.max(0, (now - state.last) / 1000));
      state.last = now;
      render();
      if (state.time < finish) state.frame = win.requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      if (win.document.visibilityState === "hidden") {
        if (state.frame) win.cancelAnimationFrame(state.frame);
        state.frame = 0;
        state.last = null;
      } else if (!state.frame && state.time < finish) {
        state.frame = win.requestAnimationFrame(tick);
      }
    };
    win.document.addEventListener("visibilitychange", onVisibility);
    state.frame = win.requestAnimationFrame(tick);
    return () => {
      win.document.removeEventListener("visibilitychange", onVisibility);
      if (state.frame) win.cancelAnimationFrame(state.frame);
      state.frame = 0;
    };
  }, [restartKey]);

  useLayoutEffect(() => {
    if (clock.current.frame === 0) render();
  }, [size.width, size.height, ratio]);

  useEffect(
    () => () => {
      program.current?.dispose();
      program.current = null;
    },
    [],
  );
}

function Halo({ frame, cornerRadius, speed, colors }: { frame: number[]; cornerRadius: number; speed: number; colors: Vec4[] }) {
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const dark = useDark();
  const ratio = useDevicePixelRatio(host);
  const width = frame[2]! + HALO_INSET * 2;
  const height = frame[3]! + HALO_INSET * 2;
  const first = colors[0]!;
  const second = colors[1] ?? first;
  const values = useRef(new Float32Array(8));
  useAnimatedCanvas(
    canvas,
    HALO_FRAGMENT,
    HALO_UNIFORMS,
    HALO_FINISH,
    "halo",
    ({ gl, program, uniforms }, time) => {
      gl.useProgram(program);
      const packed = values.current;
      packed.set(first, 0);
      packed.set(second, 4);
      gl.uniform2f(uniforms.resolution, width, height);
      gl.uniform1i(uniforms.direction, 0);
      gl.uniform4fv(uniforms.colors, packed);
      gl.uniform1i(uniforms.isDark, dark ? 1 : 0);
      gl.uniform1f(uniforms.time, time);
      gl.uniform1f(uniforms.speed, speed);
      gl.uniform1f(uniforms.delay, 0.18);
      gl.uniform1f(uniforms.fadeOutStart, 1);
      gl.uniform1f(uniforms.fadeOutDuration, 0.2);
      gl.uniform1f(uniforms.inset, HALO_INSET);
      gl.uniform1f(uniforms.cornerRadius, cornerRadius);
    },
    { width, height },
    ratio,
  );
  return createElement(
    "div",
    {
      ref: host,
      "data-power-up-halo": "",
      style: { position: "absolute", left: frame[0]! - HALO_INSET, top: frame[1]! - HALO_INSET, width, height, pointerEvents: "none" },
    },
    createElement("canvas", { ref: canvas, style: { ...layer, width: "100%", height: "100%" } }),
  );
}

export const PowerUp = forwardRef<unknown, ViewProps>(function PowerUp(props, ref) {
  const { own, rest } = splitProps("ArdiaPowerUp", props);
  const host = useRef<HTMLElement | null>(null);
  const setRef = useMergedRef(ref, host);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const size = useElementSize(host);
  const ratio = useDevicePixelRatio(host);
  const srgb = paletteColors(own.palette);
  const colors = srgb.slice(0, MAX_POWER_UP_COLORS).map(oklab);
  const speed = typeof own.speed === "number" ? own.speed : 1.25;
  const origin = typeof own.origin === "number" ? own.origin : 0.5;
  const cornerRadius = typeof own.cornerRadius === "number" ? own.cornerRadius : 20;
  const haloFrame = Array.isArray(own.haloFrame) && own.haloFrame.length === 4 && own.haloFrame[2] > 0 && own.haloFrame[3] > 0 ? (own.haloFrame as number[]) : null;
  const packed = useRef(new Float32Array(MAX_POWER_UP_COLORS * 4));

  useAnimatedCanvas(
    canvas,
    POWER_UP_FRAGMENT,
    POWER_UP_UNIFORMS,
    POWER_UP_FINISH,
    "power-up",
    ({ gl, program, uniforms }, time) => {
      gl.useProgram(program);
      const values = packed.current;
      for (let index = 0; index < colors.length; index++) values.set(colors[index]!, index * 4);
      gl.uniform1i(uniforms.direction, 0);
      gl.uniform1i(uniforms.numberOfColors, colors.length);
      gl.uniform4fv(uniforms.colors, values);
      gl.uniform1f(uniforms.time, time);
      gl.uniform1f(uniforms.speed, speed);
      gl.uniform1f(uniforms.delay, 0);
      gl.uniform1f(uniforms.fadeOutStart, 1);
      gl.uniform1f(uniforms.fadeOutDuration, 2);
      gl.uniform1f(uniforms.origin, origin);
    },
    size,
    ratio,
  );

  return createElement(
    View,
    { ...rest, ref: setRef, pointerEvents: "none", dataSet: { ...(rest.dataSet as object), powerUp: "" } },
    createElement("canvas", { ref: canvas, style: { ...layer, width: "100%", height: "100%", filter: "blur(24px)" } }),
    haloFrame ? createElement(Halo, { frame: haloFrame, cornerRadius: cornerRadius + 2, speed, colors: srgb }) : null,
  );
});
