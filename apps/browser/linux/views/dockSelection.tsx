import { createElement, forwardRef, useEffect, useState, type CSSProperties } from "react";
import { View } from "../runtime/reactNative";
import { cssHex, splitProps, type ViewProps } from "./common";

type IconImages = { blurred: string; darkRing: string; glow: string; template: string };

const BLUR_RADIUS = 5;
const BLUR_MARGIN = BLUR_RADIUS * 3;

const cache = new Map<string, Promise<IconImages | null>>();

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${src.slice(0, 64)}`));
    image.src = src;
  });

const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const context = (canvas: HTMLCanvasElement) => canvas.getContext("2d", { willReadFrequently: true })!;

async function sourceCanvas(uri: string | null, emoji: string | null): Promise<HTMLCanvasElement | null> {
  if (emoji) {
    const canvas = canvasOf(32, 32);
    const ctx = context(canvas);
    ctx.scale(2, 2);
    ctx.font = "16px system-ui, 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, 8, 8.5);
    return canvas;
  }
  if (!uri) return null;
  const image = await loadImage(uri);
  const canvas = canvasOf(image.naturalWidth, image.naturalHeight);
  context(canvas).drawImage(image, 0, 0);
  return canvas;
}

const luminanceWeights = [0.2125, 0.7154, 0.0721] as const;

function colorControls(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = canvasOf(source.width, source.height);
  const ctx = context(canvas);
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]! / 255;
    if (a === 0) continue;
    const r = data[i]! / 255 / a;
    const g = data[i + 1]! / 255 / a;
    const b = data[i + 2]! / 255 / a;
    const grey = r * luminanceWeights[0] + g * luminanceWeights[1] + b * luminanceWeights[2];
    const adjust = (c: number) => Math.min(1, Math.max(0, grey + (c - grey) * 2 - 0.1)) * a * 255;
    data[i] = adjust(r);
    data[i + 1] = adjust(g);
    data[i + 2] = adjust(b);
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

function glow(rgb: [number, number, number]): [[number, number, number], number] {
  const top = Math.max(...rgb);
  const chroma = top - Math.min(...rgb);
  if (top <= 0) return [[0, 0, 0], 0];
  const bright = rgb.map((c) => c / top) as [number, number, number];
  return [bright.map((c) => c + (1 - c) * 0.35) as [number, number, number], Math.min(1, chroma * 1.5)];
}

function glassGlow(blurred: HTMLCanvasElement): HTMLCanvasElement {
  const scale = Math.min(1, 64 / Math.max(blurred.width, blurred.height, 1));
  const canvas = canvasOf(Math.max(1, Math.floor(blurred.width * scale)), Math.max(1, Math.floor(blurred.height * scale)));
  const ctx = context(canvas);
  ctx.drawImage(blurred, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]! / 255;
    if (a <= 0) continue;
    const [rgb, strength] = glow([data[i]! / 255, data[i + 1]! / 255, data[i + 2]! / 255]);
    const alpha = a * strength;
    data[i] = Math.round(rgb[0] * 255);
    data[i + 1] = Math.round(rgb[1] * 255);
    data[i + 2] = Math.round(rgb[2] * 255);
    data[i + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

export function glowColor(hex: unknown): string | undefined {
  const css = cssHex(hex);
  if (!css) return undefined;
  const [r, g, b] = css.slice(5, -1).split(",").map(Number) as [number, number, number];
  const [rgb, strength] = glow([r / 255, g / 255, b / 255]);
  if (strength <= 0) return undefined;
  return `rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},${strength.toFixed(4)})`;
}

async function buildImages(uri: string | null, emoji: string | null): Promise<IconImages | null> {
  const source = await sourceCanvas(uri, emoji);
  if (!source) return null;
  const blurredCanvas = canvasOf(source.width + BLUR_MARGIN * 2, source.height + BLUR_MARGIN * 2);
  const blurCtx = context(blurredCanvas);
  blurCtx.filter = `blur(${BLUR_RADIUS}px)`;
  blurCtx.drawImage(source, BLUR_MARGIN, BLUR_MARGIN);
  const template = canvasOf(source.width, source.height);
  const templateCtx = context(template);
  templateCtx.drawImage(source, 0, 0);
  templateCtx.globalCompositeOperation = "source-in";
  templateCtx.fillStyle = "#fff";
  templateCtx.fillRect(0, 0, template.width, template.height);
  return {
    blurred: blurredCanvas.toDataURL(),
    darkRing: colorControls(blurredCanvas).toDataURL(),
    glow: glassGlow(blurredCanvas).toDataURL(),
    template: template.toDataURL(),
  };
}

function iconImages(uri: string | null, emoji: string | null): Promise<IconImages | null> {
  const key = emoji ? `e:${emoji}` : `u:${uri ?? ""}`;
  let images = cache.get(key);
  if (!images) {
    images = buildImages(uri, emoji).catch(() => null);
    cache.set(key, images);
  }
  return images;
}

const layer: CSSProperties = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "none" };

const big = (image: string): CSSProperties => ({
  position: "absolute",
  left: "-75%",
  top: "-75%",
  width: "250%",
  height: "250%",
  backgroundImage: `url(${image})`,
  backgroundSize: "cover",
  backgroundPosition: "center",
});

const ringMask = (width: number): CSSProperties => ({
  padding: width,
  boxSizing: "border-box",
  mask: "linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)",
  WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
  WebkitMaskComposite: "xor",
});

export const DockSelection = forwardRef<unknown, ViewProps>(function DockSelection(props, ref) {
  const { own, rest } = splitProps("ArdiaDockSelection", props);
  const uri = typeof own.image === "string" && own.image ? own.image : null;
  const emoji = typeof own.emoji === "string" && own.emoji ? own.emoji : null;
  const [images, setImages] = useState<IconImages | null>(null);
  useEffect(() => {
    let live = true;
    setImages(null);
    if (!uri && !emoji) return;
    void iconImages(uri, emoji).then((loaded) => live && setImages(loaded));
    return () => {
      live = false;
    };
  }, [uri, emoji]);

  const kind = typeof own.theme === "string" ? own.theme : "";
  const dark = own.dark !== false;
  const glass = own.glass === true;
  const cornerRadius = typeof own.cornerRadius === "number" ? own.cornerRadius : 10;
  const strokeWidthPoints = typeof own.strokeWidth === "number" ? own.strokeWidth : 3;
  const iconSize = typeof own.iconSize === "number" ? own.iconSize : 16;
  const scale = typeof window === "undefined" ? 2 : window.devicePixelRatio || 2;
  const width = Math.round(strokeWidthPoints * scale) / scale;
  const radius = `min(${cornerRadius}px, 50%)`;
  const children: React.ReactNode[] = [];

  if (glass) {
    const glowImage = kind === "blur" ? images?.glow : undefined;
    const color = kind === "template" ? glowColor(own.fill) : undefined;
    children.push(
      createElement("div", {
        key: "lift",
        style: { ...layer, borderRadius: radius, boxShadow: `0 1px 6px rgba(0,0,0,${dark ? 0.5 : 0.2})` },
      }),
    );
    if (glowImage || color) {
      children.push(
        createElement(
          "div",
          { key: "hue", style: { ...layer, borderRadius: radius, overflow: "hidden", opacity: dark ? 0.35 : 0.3, backgroundColor: color } },
          glowImage ? createElement("div", { style: big(glowImage) }) : null,
        ),
      );
    }
    children.push(
      createElement("div", {
        key: "sheen",
        style: {
          ...layer,
          borderRadius: radius,
          background: `linear-gradient(to bottom, rgba(255,255,255,${dark ? 0.12 : 0.4}) 0%, rgba(255,255,255,0) 60%)`,
        },
      }),
      createElement("div", {
        key: "rim",
        style: {
          ...layer,
          ...ringMask(width),
          borderRadius: radius,
          background: `linear-gradient(to bottom, rgba(255,255,255,${dark ? 0.5 : 1}), rgba(255,255,255,${dark ? 0.14 : 0.55}))`,
        },
      }),
    );
  } else {
    const blurred = kind === "blur" ? images : null;
    children.push(
      createElement(
        "div",
        { key: "tile", style: { ...layer, borderRadius: radius, overflow: "hidden" } },
        createElement("div", {
          style: { ...layer, backgroundColor: blurred ? `rgba(255,255,255,${dark ? 0.2 : 1})` : cssHex(own.fill) },
        }),
        blurred ? createElement("div", { style: { ...big(blurred.blurred), opacity: 0.22 } }) : null,
      ),
    );
    if (blurred) {
      children.push(
        createElement(
          "div",
          { key: "ring", style: { ...layer, ...ringMask(width), borderRadius: radius, overflow: "hidden", backgroundColor: dark ? "#000" : "#fff" } },
          createElement("div", { style: { ...big(dark ? blurred.darkRing : blurred.blurred), opacity: dark ? 0.75 : 1 } }),
        ),
      );
    } else {
      const stroke = cssHex(own.stroke);
      children.push(
        createElement("div", {
          key: "ring",
          style: {
            ...layer,
            borderRadius: radius,
            boxSizing: "border-box",
            border: `${width}px solid ${stroke ?? "#fff"}`,
            mixBlendMode: stroke ? undefined : "soft-light",
          },
        }),
      );
    }
    if (kind === "template" && images) {
      children.push(
        createElement("div", {
          key: "icon",
          style: {
            position: "absolute",
            left: "50%",
            top: "50%",
            width: iconSize,
            height: iconSize,
            marginLeft: -iconSize / 2,
            marginTop: -iconSize / 2,
            backgroundImage: `url(${images.template})`,
            backgroundSize: "100% 100%",
            pointerEvents: "none",
          },
        }),
      );
    }
  }

  return createElement(View, { ...rest, ref, pointerEvents: "none", dataSet: { ...(rest.dataSet as object), dockSelection: glass ? "glass" : kind || "plain" } }, ...children);
});
