import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { View } from "../runtime/reactNative";
import { fire, splitProps, useLatest, useMergedRef, type ViewProps } from "./common";

const MAX_ITEMS = 50;
const LINK_FILE_EXTENSIONS = new Set(["webloc", "inetloc", "url"]);
const MAX_LINK_FILE_SIZE = 64 * 1024;

export type DroppedItem = { kind: "file"; url: string } | { kind: "url"; url: string } | { kind: "text"; text: string };

const fileUrl = (path: string) => `file://${path.split("/").map(encodeURIComponent).join("/")}`;

export function webURL(raw: string): string | null {
  const text = raw.trim();
  if (text.length >= 8192) return null;
  try {
    const url = new URL(text);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function hostLike(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length >= 2048 || /\s/.test(text)) return null;
  const colon = text.indexOf(":");
  if (colon > 0) {
    const scheme = text.slice(0, colon);
    if (/^[\p{L}\p{N}+.-]+$/u.test(scheme) && !scheme.includes(".")) return webURL(text);
  }
  return text.includes(".") ? text : null;
}

export function linkTarget(name: string, contents: string): string | null {
  if (name.toLowerCase().endsWith(".url")) {
    for (const line of contents.split(/\r?\n|\r/)) if (line.toLowerCase().startsWith("url=")) return webURL(line.slice(4));
    return null;
  }
  const match = /<key>\s*URL\s*<\/key>\s*<string>([^<]*)<\/string>/.exec(contents);
  return match?.[1] ? webURL(match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")) : null;
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export const nativeFilePath = (file: File): string | null => {
  const native = (globalThis as { ardiaNativeFilePath?: (file: File) => string | null }).ardiaNativeFilePath;
  const path = native?.(file) ?? (file as File & { path?: string }).path ?? null;
  return path && path.startsWith("/") ? path : null;
};

const uriList = (transfer: DataTransfer) =>
  transfer
    .getData("text/uri-list")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

export async function droppedItems(transfer: DataTransfer): Promise<DroppedItem[]> {
  const files = [...transfer.files];
  const uris = uriList(transfer);
  const fileUris = uris.filter((uri) => uri.startsWith("file:///"));
  if (files.length || fileUris.length) {
    const items: DroppedItem[] = [];
    const paths = files.map(nativeFilePath);
    for (let i = 0; i < files.length && items.length < MAX_ITEMS; i++) {
      const file = files[i]!;
      const path = paths[i] ?? (fileUris[i] ? decodeURIComponent(new URL(fileUris[i]!).pathname) : null);
      if (LINK_FILE_EXTENSIONS.has(extensionOf(file.name))) {
        if (file.size > MAX_LINK_FILE_SIZE) continue;
        const target = linkTarget(file.name, await file.text().catch(() => ""));
        if (target) items.push({ kind: "url", url: target });
        continue;
      }
      if (path) items.push({ kind: "file", url: fileUrl(path) });
    }
    if (!files.length) {
      for (const uri of fileUris.slice(0, MAX_ITEMS)) items.push({ kind: "file", url: new URL(uri).href });
    }
    if (items.length || files.length) return items;
  }
  const links = uris.map(webURL).filter((url): url is string => !!url);
  if (links.length) return links.slice(0, MAX_ITEMS).map((url) => ({ kind: "url", url }));
  const text = transfer.getData("text/plain");
  const candidate = text ? hostLike(text) : null;
  if (candidate) {
    const url = webURL(candidate);
    return [url ? { kind: "url", url } : { kind: "text", text: candidate }];
  }
  return [];
}

export function draggedCount(transfer: DataTransfer | null): number {
  if (!transfer) return 0;
  const files = [...transfer.items].filter((item) => item.kind === "file").length;
  if (files) return Math.min(files, MAX_ITEMS);
  const types = [...transfer.types];
  return types.includes("text/uri-list") || types.includes("text/plain") ? 1 : 0;
}

export const FileDrop = forwardRef<unknown, ViewProps>(function FileDrop(props, ref) {
  const { own, rest } = splitProps("ArdiaFileDrop", props);
  const host = useRef<HTMLElement | null>(null);
  const latest = useLatest(own);
  useImperativeHandle(ref, () => ({ nativeRef: host, getNativeRef: () => host.current }), []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let depth = 0;
    let count = 0;
    const emit = (phase: string, event: DragEvent | null, items: DroppedItem[] = []) => {
      const rect = element.getBoundingClientRect();
      const x = event ? event.clientX - rect.left : 0;
      const y = event ? event.clientY - rect.top : 0;
      fire(latest.current.onDropUpdate, "onDropUpdate", { phase, x, y, count, items }, element);
    };
    const accept = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onEnter = (event: DragEvent) => {
      if (depth++ > 0) {
        if (count > 0) accept(event);
        return;
      }
      count = draggedCount(event.dataTransfer);
      if (count === 0) return;
      accept(event);
      emit("enter", event);
    };
    const onOver = (event: DragEvent) => {
      if (count === 0) return;
      accept(event);
      emit("move", event);
    };
    const onLeave = (event: DragEvent) => {
      if (depth === 0 || --depth > 0) return;
      if (count === 0) return;
      emit("exit", event);
      count = 0;
    };
    const onDrop = (event: DragEvent) => {
      depth = 0;
      if (count === 0 || !event.dataTransfer) return;
      event.preventDefault();
      const transfer = event.dataTransfer;
      const snapshot = { clientX: event.clientX, clientY: event.clientY } as DragEvent;
      const pending = droppedItems(transfer);
      void pending.then((items) => {
        emit("drop", snapshot, items);
        count = 0;
      });
    };
    element.addEventListener("dragenter", onEnter);
    element.addEventListener("dragover", onOver);
    element.addEventListener("dragleave", onLeave);
    element.addEventListener("drop", onDrop);
    return () => {
      element.removeEventListener("dragenter", onEnter);
      element.removeEventListener("dragover", onOver);
      element.removeEventListener("dragleave", onLeave);
      element.removeEventListener("drop", onDrop);
    };
  }, []);

  return createElement(View, { ...rest, ref: host });
});

export const FileDrag = forwardRef<unknown, ViewProps>(function FileDrag(props, ref) {
  const { own, rest } = splitProps("ArdiaFileDrag", props);
  const host = useRef<HTMLElement | null>(null);
  const setRef = useMergedRef(ref, host);
  const latest = useLatest(own);
  const path = typeof own.path === "string" && own.path.startsWith("/") ? own.path : null;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    const onAuxClick = (event: MouseEvent) => {
      if (event.button !== 1) return;
      fire(latest.current.onMiddleClick, "onMiddleClick", { shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey || event.ctrlKey }, element);
    };
    element.addEventListener("mousedown", onMouseDown);
    element.addEventListener("auxclick", onAuxClick);
    return () => {
      element.removeEventListener("mousedown", onMouseDown);
      element.removeEventListener("auxclick", onAuxClick);
    };
  }, []);

  useEffect(() => {
    const element = host.current;
    if (!element || !path) return;
    element.draggable = true;
    const onDragStart = (event: DragEvent) => {
      const transfer = event.dataTransfer;
      if (!transfer) return;
      event.stopPropagation();
      const url = fileUrl(path);
      transfer.effectAllowed = "copy";
      transfer.setData("text/uri-list", url);
      transfer.setData("text/plain", path);
      (globalThis as { __ardiaLastFileDrag?: string[] }).__ardiaLastFileDrag = [path];
    };
    element.addEventListener("dragstart", onDragStart);
    return () => {
      element.draggable = false;
      element.removeEventListener("dragstart", onDragStart);
    };
  }, [path]);

  return createElement(View, { ...rest, ref: setRef });
});
