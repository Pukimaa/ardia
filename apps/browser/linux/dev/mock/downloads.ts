import { emit } from "./core";

type MockDownload = {
  id: string;
  url: string;
  filename: string;
  path: string;
  state: "downloading" | "finished" | "failed" | "cancelled";
  paused: boolean;
  received: number;
  total: number;
  speed: number;
  mimeType: string;
  profile: string;
  offTheRecord: boolean;
};

export const downloads = new Map<string, MockDownload>();
let nextDownload = 1;
const timers = new Map<string, number>();

const TICK_MS = 120;
const BYTES_PER_TICK = 256 * 1024;

const mimeFor = (filename: string) => {
  if (/\.zip$/i.test(filename)) return "application/zip";
  if (/\.pdf$/i.test(filename)) return "application/pdf";
  if (/\.deb$/i.test(filename)) return "application/vnd.debian.binary-package";
  if (/\.(tar\.gz|tgz)$/i.test(filename)) return "application/gzip";
  return "application/octet-stream";
};

const report = (download: MockDownload) => emit("ArdiaCEF", "onDownload", { ...download });

const tick = (download: MockDownload) => {
  if (download.state !== "downloading" || download.paused) return;
  download.received = Math.min(download.total, download.received + BYTES_PER_TICK);
  download.speed = (BYTES_PER_TICK * 1000) / TICK_MS;
  if (download.received >= download.total) {
    download.state = "finished";
    download.speed = 0;
    window.clearInterval(timers.get(download.id));
    timers.delete(download.id);
  }
  report(download);
};

const run = (download: MockDownload) => {
  window.clearInterval(timers.get(download.id));
  timers.set(
    download.id,
    window.setInterval(() => tick(download), TICK_MS),
  );
};

export function startDownload(url: string, profile: string, offTheRecord = false) {
  const filename = decodeURIComponent(url.split(/[?#]/)[0]!.split("/").pop() || "download");
  const id = String(nextDownload++);
  const download: MockDownload = {
    id,
    url,
    filename,
    path: `/home/ardia/Downloads/${filename}`,
    state: "downloading",
    paused: false,
    received: 0,
    total: /fail/i.test(url) ? 4 * BYTES_PER_TICK : 12 * BYTES_PER_TICK,
    speed: 0,
    mimeType: mimeFor(filename),
    profile,
    offTheRecord,
  };
  downloads.set(id, download);
  report(download);
  if (/fail/i.test(url))
    window.setTimeout(() => {
      download.state = "failed";
      window.clearInterval(timers.get(id));
      report(download);
    }, TICK_MS * 3);
  run(download);
  return download;
}

export function cancelDownload(id: string) {
  const download = downloads.get(id);
  if (!download || download.state !== "downloading") return;
  download.state = "cancelled";
  download.speed = 0;
  window.clearInterval(timers.get(id));
  timers.delete(id);
  report(download);
}

export function pauseDownload(id: string) {
  const download = downloads.get(id);
  if (!download || download.state !== "downloading") return;
  download.paused = true;
  download.speed = 0;
  report(download);
}

export function resumeDownload(id: string) {
  const download = downloads.get(id);
  if (!download || download.state !== "downloading") return;
  download.paused = false;
  report(download);
  run(download);
}

export function clearDownloads() {
  for (const id of [...downloads.keys()]) if (downloads.get(id)?.state !== "downloading") downloads.delete(id);
}
