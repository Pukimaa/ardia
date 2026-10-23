import "./setup";
import "../../runtime/install";
import "../index";
import { WebView, type WebViewHandle } from "@ardia/ardiacore/src/WebView";
import { SwipeArea } from "@ardia/ardiacore/src/swipe";
import { PowerUp, ThemeSwatch, WindowBackdrop } from "@ardia/shaders";
import {
  ActivitySpinner,
  ContextMenuArea,
  DockSelection,
  FadeLabel,
  FileDropArea,
  GlassEffect,
  MouseArea,
  OutsidePressArea,
  Surface,
  Symbol,
  VisualEffect,
  WindowDragRegion,
} from "@ardia/shell";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppRegistry, Text, View } from "react-native";
import { trackerFor, windowIdOf } from "../nativeViews";
import { symbolGlyphs, weakSymbolMatches } from "../symbols/symbols.generated";

type CefState = { mounted: boolean; scroll: number; shift: number; url: string; clipped: boolean };

type GalleryControls = {
  events: { name: string; args: unknown[] }[];
  cef: { set(state: Partial<CefState>): void; handle(): WebViewHandle | null };
  replayPowerUp(): void;
};

declare global {
  interface Window {
    __gallery?: GalleryControls;
  }
}

const data = (set: Record<string, string>) => ({ dataSet: set }) as object;

const events: GalleryControls["events"] = [];
const log =
  (name: string) =>
  (...args: unknown[]) =>
    events.push({
      name,
      args: JSON.parse(JSON.stringify(args.map((arg) => (arg && typeof arg === "object" && "nativeEvent" in arg ? (arg as { nativeEvent: unknown }).nativeEvent : arg)))) as unknown[],
    });

const iconCanvas = (paint: (ctx: CanvasRenderingContext2D) => void) => {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  paint(canvas.getContext("2d")!);
  return canvas.toDataURL();
};

const colorfulIcon = iconCanvas((ctx) => {
  const gradient = ctx.createLinearGradient(0, 0, 32, 32);
  gradient.addColorStop(0, "#ff3b30");
  gradient.addColorStop(0.5, "#ffcc00");
  gradient.addColorStop(1, "#0a84ff");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(16, 16, 15, 0, Math.PI * 2);
  ctx.fill();
});

const flatIcon = iconCanvas((ctx) => {
  ctx.fillStyle = "#1DB954";
  ctx.beginPath();
  ctx.arc(16, 16, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.clearRect(9, 13, 14, 6);
});

function Section({ name, title, children, dark }: { name: string; title: string; children: ReactNode; dark?: boolean }) {
  return (
    <View
      {...data({ section: name })}
      style={{ padding: 16, margin: 8, borderRadius: 12, backgroundColor: dark ? "#1c1c1e" : "#f5f5f7", alignSelf: "flex-start" }}
    >
      <Text style={{ fontSize: 12, fontWeight: "600", color: dark ? "#fff" : "#000", marginBottom: 10 }}>{title}</Text>
      {children}
    </View>
  );
}

const symbolNames = Object.keys(symbolGlyphs);

function Symbols({ dark }: { dark: boolean }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", width: 760 }}>
      {symbolNames.map((name) => (
        <View key={name} style={{ width: 38, height: 34, alignItems: "center", justifyContent: "center" }}>
          <Symbol name={name} size={15} color={weakSymbolMatches.includes(name) ? "#FF9500" : dark ? "#FFFFFFD9" : "#000000D9"} style={{ width: 18, height: 18 }} />
        </View>
      ))}
    </View>
  );
}

function SymbolWeights() {
  const weights = ["light", "regular", "medium", "semibold", "bold"] as const;
  return (
    <View style={{ gap: 6 }}>
      {[11, 13, 15, 20].map((size) => (
        <View key={size} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <Text style={{ width: 28, fontSize: 11, color: "#666" }}>{size}pt</Text>
          {weights.map((weight) =>
            ["sidebar.left", "chevron.left", "arrow.clockwise", "xmark", "lock.fill", "magnifyingglass"].map((name) => (
              <Symbol key={`${weight}-${name}`} name={name} size={size} weight={weight} style={{ width: size + 6, height: size + 6 }} />
            )),
          )}
        </View>
      ))}
    </View>
  );
}

function Labels() {
  return (
    <View style={{ gap: 8, width: 220 }}>
      <View style={{ height: 20, width: 200, backgroundColor: "#ffffff" }}>
        <FadeLabel text="Short title" fontSize={13} color="#000000D9" style={{ flex: 1 }} />
      </View>
      <View {...data({ fade: "overflow" })} style={{ height: 20, width: 160, backgroundColor: "#ffffff" }}>
        <FadeLabel text="A much longer tab title that does not fit at all" fontSize={13} color="#000000D9" style={{ flex: 1 }} />
      </View>
      <View style={{ height: 22, width: 160, backgroundColor: "#202020" }}>
        <FadeLabel text="Semibold 0123456789 digits" fontSize={14} weight="semibold" color="#FFFFFF" fadeWidth={40} style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <ActivitySpinner style={{ width: 12, height: 12 }} />
        <ActivitySpinner style={{ width: 16, height: 16 }} />
        <ActivitySpinner style={{ width: 24, height: 24 }} />
      </View>
    </View>
  );
}

function Surfaces() {
  return (
    <View style={{ flexDirection: "row", gap: 18, padding: 10 }}>
      <Surface fill="#FFFFFF" cornerRadius={10} shadowColor="#000000" shadowOpacity={0.25} shadowRadius={8} shadowOffset={[0, 4]} style={{ width: 90, height: 60 }} />
      <Surface fill="#2C2C2E" cornerRadius={14} borderColor="#FFFFFF33" borderWidth={1} style={{ width: 90, height: 60 }} />
      <Surface fill="#1C1C1E" cornerRadius={12} borderWidth={1.5} borderColors={["#FFFFFF80", "#FFFFFF10"]} style={{ width: 90, height: 60 }}>
        <Text style={{ color: "#fff", fontSize: 11, margin: 8 }}>child</Text>
      </Surface>
    </View>
  );
}

const STRIPES = { backgroundImage: "linear-gradient(135deg, #ff2d55 0 25%, #5856d6 25% 50%, #34c759 50% 75%, #ff9500 75%)" } as object;

function Materials({ dark }: { dark: boolean }) {
  const materials = ["hudWindow", "popover", "menu", "sidebar", "titlebar", "sheet", "contentBackground", "selection"];
  return (
    <View style={[{ flexDirection: "row", flexWrap: "wrap", gap: 8, width: 520, padding: 8 }, STRIPES]}>
      {materials.map((material) => (
        <VisualEffect key={material} material={material} cornerRadius={10} style={{ width: 118, height: 50, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ fontSize: 10, color: dark ? "#fff" : "#000" }}>{material}</Text>
        </VisualEffect>
      ))}
      <GlassEffect cornerRadius={14} tint="#FF2D5533" dark={dark} style={{ width: 118, height: 50 }} />
    </View>
  );
}

function Docks() {
  return (
    <View style={{ flexDirection: "row", gap: 14, padding: 10, backgroundColor: "#3a3a3c" }}>
      <DockSelection image={flatIcon} theme="template" fill="#1DB954" dark cornerRadius={10} style={{ width: 36, height: 36 }} />
      <DockSelection image={colorfulIcon} theme="blur" dark cornerRadius={10} style={{ width: 36, height: 36 }} />
      <DockSelection image={colorfulIcon} theme="blur" dark={false} cornerRadius={10} style={{ width: 36, height: 36 }} />
      <DockSelection emoji="🍕" theme="blur" dark cornerRadius={10} style={{ width: 36, height: 36 }} />
      <DockSelection image={colorfulIcon} theme="blur" dark glass cornerRadius={10} style={{ width: 36, height: 36 }} />
      <DockSelection image={flatIcon} theme="template" fill="#1DB954" dark glass cornerRadius={10} style={{ width: 36, height: 36 }} />
    </View>
  );
}

const PINK_THEME = [0.98, 0.42, 0.62, 1, 0.42, 0.45, 0.98, 1, 1, 0.85, 0.5, 0.35];

function Backdrops() {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <View {...data({ backdrop: "gradient" })} style={{ width: 160, height: 120, borderRadius: 10, overflow: "hidden" }}>
        <WindowBackdrop colors={["#3B1F2B", "#1E1B2E"]} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      </View>
      <View style={{ width: 160, height: 120, borderRadius: 10, overflow: "hidden" }}>
        <WindowBackdrop colors={["#F4D6DE", "#DCD8F4"]} angle={135} grainOpacity={0.2} grainScale={2} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      </View>
      <View style={{ width: 160, height: 120, borderRadius: 10, overflow: "hidden" }}>
        <WindowBackdrop colors={["#000000", "#000000"]} vibrancy tintColor="#B25B6B" tintAlpha={0.36} tintLightness={0.25} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      </View>
      <View style={{ width: 160, height: 120, borderRadius: 10, overflow: "hidden" }}>
        <WindowBackdrop
          colors={["#000000", "#000000"]}
          vibrancy
          themeColors={PINK_THEME}
          themeOpacity={0.9}
          themeBaseAlpha={0.2}
          themeGrain={0.6}
          themeTexture="denim"
          themeAppearance="dark"
          style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
        />
      </View>
    </View>
  );
}

function Swatches() {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <ThemeSwatch colors={PINK_THEME} style={{ width: 64, height: 64, borderRadius: 32, overflow: "hidden" }} />
      <ThemeSwatch colors={[0.2, 0.5, 1, 1, 0.1, 0.9, 0.7, 1]} grain={0.8} texture="sand" style={{ width: 64, height: 64, borderRadius: 12, overflow: "hidden" }} />
      <ThemeSwatch colors={[0.9, 0.3, 0.2, 1]} grain={0.8} texture="tweed" style={{ width: 96, height: 64, borderRadius: 12, overflow: "hidden" }} />
      <ThemeSwatch colors={[]} padLightness={0.6} style={{ width: 64, height: 64, borderRadius: 32, overflow: "hidden" }} />
    </View>
  );
}

function PowerUps() {
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (window.__gallery) window.__gallery.replayPowerUp = () => setRun((n) => n + 1);
  }, []);
  return (
    <View key={run} style={{ width: 420, height: 220, backgroundColor: "#111", borderRadius: 14, overflow: "hidden" }}>
      <PowerUp palette="pink" origin={0.5} cornerRadius={20} halo={{ x: 60, y: 120, width: 300, height: 56 }} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      <View style={{ position: "absolute", left: 60, top: 120, width: 300, height: 56, borderRadius: 22, backgroundColor: "#2a2a2a" }} />
    </View>
  );
}

function Behaviours() {
  return (
    <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap", width: 560 }}>
      <ContextMenuArea onContextMenu={log("contextMenu")} style={{ width: 120, height: 50, backgroundColor: "#d1d1d6" }}>
        <View {...data({ behaviour: "context" })} style={{ flex: 1 }} />
      </ContextMenuArea>
      <OutsidePressArea onOutsidePress={log("outsidePress")} style={{ width: 120, height: 50, backgroundColor: "#c7c7cc" }}>
        <View {...data({ behaviour: "inside" })} style={{ flex: 1 }} />
      </OutsidePressArea>
      <View {...data({ behaviour: "drag" })} style={{ width: 120, height: 50 }}>
        <WindowDragRegion style={{ flex: 1, backgroundColor: "#aeaeb2" }} />
      </View>
      <View {...data({ behaviour: "press-drag" })} style={{ width: 120, height: 50 }}>
        <WindowDragRegion titleBarDoubleClick={false} onRegionDoubleClick={log("regionDoubleClick")} style={{ flex: 1, backgroundColor: "#8e8e93" }} />
      </View>
      <FileDropArea onDropUpdate={log("drop")} style={{ width: 120, height: 50, backgroundColor: "#e5e5ea" }}>
        <View {...data({ behaviour: "drop" })} style={{ flex: 1 }} />
      </FileDropArea>
      <MouseArea path="/tmp/example.pdf" onMiddleClick={log("middleClick")} style={{ width: 120, height: 50, backgroundColor: "#f2f2f7" }}>
        <View {...data({ behaviour: "file-drag" })} style={{ flex: 1 }} />
      </MouseArea>
      <SwipeArea canSwipeBack canSwipeForward={false} onSwipe={log("swipe")} style={{ width: 120, height: 50, backgroundColor: "#d8d8dc" }}>
        <View {...data({ behaviour: "swipe" })} style={{ flex: 1 }} />
      </SwipeArea>
    </View>
  );
}

function CefLab() {
  const [state, setState] = useState<CefState>({ mounted: true, scroll: 0, shift: 0, url: "https://example.com/", clipped: true });
  const handle = useRef<WebViewHandle | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!window.__gallery) return;
    window.__gallery.cef = { set: (partial) => setState((previous) => ({ ...previous, ...partial })), handle: () => handle.current };
  }, []);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = state.scroll;
  }, [state.scroll]);
  return (
    <View {...data({ cefStage: "" })} style={{ width: 320, height: 240, backgroundColor: "#ddd", transform: [{ translateX: state.shift }] }}>
      <View
        ref={(node: unknown) => {
          scroller.current = node as HTMLElement | null;
        }}
        {...data({ cefScroller: "" })}
        style={{ position: "absolute", left: 20, top: 30, width: 260, height: 180, overflow: state.clipped ? "scroll" : "visible", backgroundColor: "#eee" }}
      >
        <View style={{ height: 600 }}>
          {state.mounted ? (
            <WebView
              ref={handle}
              url={state.url}
              profile="default"
              visible
              onProgress={log("progress")}
              onNavigationChange={log("navigationChange")}
              onReady={log("ready")}
              style={{ position: "absolute", left: 10, top: 40, width: 300, height: 400, backgroundColor: "#0a84ff22" }}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Gallery() {
  return (
    <View style={{ padding: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start" }}>
      <Section name="symbols" title={`Symbols (${symbolNames.length}; orange = weak match)`}>
        <Symbols dark={false} />
      </Section>
      <Section name="symbols-dark" title="Symbols, dark" dark>
        <Symbols dark />
      </Section>
      <Section name="symbol-weights" title="Weights × sizes">
        <SymbolWeights />
      </Section>
      <Section name="labels" title="FadeLabel, ActivitySpinner">
        <Labels />
      </Section>
      <Section name="surfaces" title="Surface">
        <Surfaces />
      </Section>
      <Section name="materials" title="VisualEffect, GlassEffect">
        <Materials dark={false} />
      </Section>
      <Section name="docks" title="DockSelection" dark>
        <Docks />
      </Section>
      <Section name="backdrops" title="WindowBackdrop">
        <Backdrops />
      </Section>
      <Section name="swatches" title="ThemeSwatch">
        <Swatches />
      </Section>
      <Section name="power-up" title="PowerUp + halo" dark>
        <PowerUps />
      </Section>
      <Section name="behaviours" title="Behaviours">
        <Behaviours />
      </Section>
      <Section name="cef" title="ArdiaCEF placeholder">
        <CefLab />
      </Section>
    </View>
  );
}

(window as unknown as { __ardiaViewsTesting: object }).__ardiaViewsTesting = { trackerFor, windowIdOf };
window.__gallery = { events, cef: { set() {}, handle: () => null }, replayPowerUp() {} };
AppRegistry.registerComponent("gallery", () => Gallery);
AppRegistry.runApplication("gallery", { rootTag: document.getElementById("root") });
