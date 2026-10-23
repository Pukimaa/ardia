export type Vec4 = [number, number, number, number];

const linear = (x: number) => (Math.abs(x) <= 0.04045 ? x / 12.92 : Math.sign(x) * Math.pow((Math.abs(x) + 0.055) / 1.055, 2.4));
const encode = (x: number) => (Math.abs(x) <= 0.0031308 ? x * 12.92 : Math.sign(x) * (1.055 * Math.pow(Math.abs(x), 1 / 2.4) - 0.055));

export function oklab(c: Vec4): Vec4 {
  const r = linear(c[0]);
  const g = linear(c[1]);
  const b = linear(c[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    c[3],
  ];
}

export function srgbFromOklab(lab: Vec4): Vec4 {
  let l = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
  let m = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
  let s = lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2];
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    lab[3],
  ];
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

export const rgbaString = (c: Vec4) =>
  `rgba(${Math.round(clamp01(c[0]) * 255)},${Math.round(clamp01(c[1]) * 255)},${Math.round(clamp01(c[2]) * 255)},${clamp01(c[3]).toFixed(4)})`;

export function parseThemeColors(flat: unknown): Vec4[] {
  if (!Array.isArray(flat)) return [];
  const out: Vec4[] = [];
  for (let i = 0; i + 3 < flat.length && out.length < 3; i += 4) {
    out.push([Number(flat[i]), Number(flat[i + 1]), Number(flat[i + 2]), Number(flat[i + 3])]);
  }
  return out;
}

export const ARC_SAMPLES = 16;
export const ARC_REACH = 0.75;

export function paintArcGradient(ctx: CanvasRenderingContext2D, width: number, height: number, colors: Vec4[]) {
  const first = colors[0];
  if (!first) return;
  const second = colors.length > 1 ? colors[1]! : first;
  const a = oklab(first);
  const b = oklab(second);
  const steps = colors.length > 1 ? ARC_SAMPLES : 1;
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  const c0 = short / 2 - (short * short) / (2 * long);
  const c1 = long + short / 2 + (short * short) / (2 * long);
  const cE = c0 + ARC_REACH * (c1 - c0);
  const norm = w * w + h * h;
  ctx.save();
  ctx.scale(ctx.canvas.width, ctx.canvas.height);
  const base = ctx.createLinearGradient((c0 * w) / norm, (c0 * h) / norm, (cE * w) / norm, (cE * h) / norm);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    base.addColorStop(t, rgbaString(srgbFromOklab([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t])));
  }
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1, 1);
  const third = colors[2];
  if (third) {
    const overlay = ctx.createLinearGradient(0.5, 0, 0.5, 1);
    overlay.addColorStop(0, rgbaString([third[0], third[1], third[2], 0]));
    overlay.addColorStop(1, rgbaString(third));
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, 1, 1);
  }
  ctx.restore();
}

export const GRAIN_SIDE = 128;

const grainTiles = new Map<string, HTMLCanvasElement>();
const grainUrls = new Map<string, string>();

export function grainTile(texture: string): HTMLCanvasElement {
  const key = ["sand", "denim", "tweed"].includes(texture) ? texture : "grain";
  const cached = grainTiles.get(key);
  if (cached) return cached;
  const n = GRAIN_SIDE;
  const alpha = new Float32Array(n * n);
  let state = 0x9e3779b9;
  const random = () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return (state % 10000) / 10000;
  };
  const add = (x: number, y: number, v: number) => {
    const i = (((y % n) + n) % n) * n + (((x % n) + n) % n);
    alpha[i] = Math.min(1, alpha[i]! + v);
  };
  switch (key) {
    case "sand":
      for (let i = 0; i < n * n; i++) alpha[i] = random() * 0.25;
      for (let k = 0; k < Math.floor((n * n) / 18); k++) {
        const x = Math.floor(random() * n);
        const y = Math.floor(random() * n);
        const v = 0.5 + random() * 0.5;
        add(x, y, v);
        add(x + 1, y, v * 0.6);
        add(x, y + 1, v * 0.6);
        add(x + 1, y + 1, v * 0.4);
      }
      break;
    case "denim":
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const twill = (x + y) % 4 < 2 ? 0.75 : 0.15;
          alpha[y * n + x] = Math.min(1, twill * (0.6 + random() * 0.4) + (y % 2 === 0 ? 0.08 : 0));
        }
      }
      break;
    case "tweed":
      for (let i = 0; i < n * n; i++) alpha[i] = random() * 0.15;
      for (let k = 0; k < Math.floor((n * n) / 40); k++) {
        const x = Math.floor(random() * n);
        const y = Math.floor(random() * n);
        const v = 0.4 + random() * 0.6;
        const horizontal = random() < 0.5;
        const length = 3 + Math.floor(random() * 4);
        for (let j = 0; j < length; j++) {
          if (horizontal) add(x + j, y, v);
          else add(x, y + j, v);
        }
      }
      break;
    default:
      for (let i = 0; i < n * n; i++) {
        const u = random();
        alpha[i] = u * u;
      }
  }
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) pixels.data[i * 4 + 3] = Math.min(255, Math.floor(alpha[i]! * 255));
  ctx.putImageData(pixels, 0, 0);
  grainTiles.set(key, canvas);
  return canvas;
}

export function grainUrl(texture: string): string {
  const key = ["sand", "denim", "tweed"].includes(texture) ? texture : "grain";
  let url = grainUrls.get(key);
  if (!url) grainUrls.set(key, (url = grainTile(key).toDataURL()));
  return url;
}

export function paintGrain(ctx: CanvasRenderingContext2D, texture: string, opacity: number, pixelRatio: number) {
  if (opacity <= 0) return;
  const pattern = ctx.createPattern(grainTile(texture), "repeat");
  if (!pattern) return;
  pattern.setTransform(new DOMMatrix().scaleSelf(pixelRatio / 2, pixelRatio / 2));
  ctx.save();
  ctx.globalAlpha = Math.min(Math.max(opacity, 0), 1);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

export function hsl(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

const pads = new Map<number, HTMLCanvasElement>();

export function padImage(lightness: number, side = 192): HTMLCanvasElement {
  const cached = pads.get(lightness);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(side, side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const dx = (x + 0.5) / side - 0.5;
      const dy = (y + 0.5) / side - 0.5;
      let hue = Math.atan2(dy, dx) / (2 * Math.PI);
      if (hue < 0) hue += 1;
      const sat = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.5);
      const [r, g, b] = hsl(hue, sat, lightness);
      const i = (y * side + x) * 4;
      pixels.data[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      pixels.data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      pixels.data[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      pixels.data[i + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  if (pads.size > 8) pads.clear();
  pads.set(lightness, canvas);
  return canvas;
}

export function adjustLightness(c: [number, number, number], delta: number): [number, number, number] {
  const [r, g, b] = c;
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (maxC + minC) / 2;
  if (maxC !== minC) {
    const d = maxC - minC;
    s = l > 0.5 ? d / (2 - maxC - minC) : d / (maxC + minC);
    h = maxC === r ? (g - b) / d + (g < b ? 6 : 0) : maxC === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const l2 = Math.min(Math.max(l + delta, 0), 1);
  if (s === 0) return [l2, l2, l2];
  return hsl(h, s, l2);
}
