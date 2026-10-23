import { registerViewManager, type ViewManagerComponent } from "../runtime/viewRegistry";
import { DockSelection } from "./dockSelection";
import { CEFView, SwipeView, WindowProfileView } from "./native";
import { PowerUp } from "./shaders/powerUp";
import { ThemeSwatch } from "./shaders/themeSwatch";
import { WindowBackdrop } from "./shaders/windowBackdrop";
import {
  ActivitySpinner,
  ContextMenuArea,
  FadeLabel,
  GlassEffect,
  OutsidePressArea,
  Surface,
  Symbol,
  VisualEffect,
  WindowDragRegion,
} from "./shell";
import { FileDrag, FileDrop } from "./system";

export const webViewManagers: Record<string, unknown> = {
  ArdiaActivitySpinner: ActivitySpinner,
  ArdiaCEF: CEFView,
  ArdiaContextMenuArea: ContextMenuArea,
  ArdiaDockSelection: DockSelection,
  ArdiaFadeLabel: FadeLabel,
  ArdiaFileDrag: FileDrag,
  ArdiaFileDrop: FileDrop,
  ArdiaGlassEffect: GlassEffect,
  ArdiaOutsidePressArea: OutsidePressArea,
  ArdiaPowerUp: PowerUp,
  ArdiaShell: WindowDragRegion,
  ArdiaSurface: Surface,
  ArdiaSwipe: SwipeView,
  ArdiaSymbol: Symbol,
  ArdiaThemeSwatch: ThemeSwatch,
  ArdiaVisualEffect: VisualEffect,
  ArdiaWindowBackdrop: WindowBackdrop,
  ArdiaWindowProfile: WindowProfileView,
};

for (const [name, component] of Object.entries(webViewManagers)) registerViewManager(name, component as ViewManagerComponent);
