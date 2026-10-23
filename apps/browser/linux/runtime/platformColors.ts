import { Appearance } from "react-native-web";

type Pair = readonly [light: string, dark: string];

const systemColors: Record<string, Pair> = {
  labelColor: ["rgba(0,0,0,0.85)", "rgba(255,255,255,0.85)"],
  secondaryLabelColor: ["rgba(0,0,0,0.5)", "rgba(255,255,255,0.55)"],
  tertiaryLabelColor: ["rgba(0,0,0,0.26)", "rgba(255,255,255,0.25)"],
  quaternaryLabelColor: ["rgba(0,0,0,0.1)", "rgba(255,255,255,0.1)"],
  textColor: ["#000000", "#FFFFFF"],
  placeholderTextColor: ["rgba(0,0,0,0.25)", "rgba(255,255,255,0.25)"],
  selectedTextColor: ["#000000", "#FFFFFF"],
  selectedTextBackgroundColor: ["#B3D7FF", "#3F638B"],
  textBackgroundColor: ["#FFFFFF", "#1E1E1E"],
  controlAccentColor: ["#007AFF", "#0A84FF"],
  controlColor: ["#FFFFFF", "rgba(255,255,255,0.25)"],
  controlBackgroundColor: ["#FFFFFF", "#1E1E1E"],
  controlTextColor: ["rgba(0,0,0,0.85)", "rgba(255,255,255,0.85)"],
  disabledControlTextColor: ["rgba(0,0,0,0.25)", "rgba(255,255,255,0.25)"],
  selectedControlColor: ["#B3D7FF", "#3F638B"],
  selectedContentBackgroundColor: ["#0063E1", "#0058D0"],
  unemphasizedSelectedContentBackgroundColor: ["#DCDCDC", "#464646"],
  windowBackgroundColor: ["#ECECEC", "#323232"],
  underPageBackgroundColor: ["#969696", "#282828"],
  windowFrameTextColor: ["rgba(0,0,0,0.85)", "rgba(255,255,255,0.85)"],
  separatorColor: ["rgba(0,0,0,0.1)", "rgba(255,255,255,0.1)"],
  gridColor: ["#E6E6E6", "#1A1A1A"],
  shadowColor: ["#000000", "#000000"],
  linkColor: ["#0068DA", "#419CFF"],
  findHighlightColor: ["#FFFF00", "#FFFF00"],
  systemBlueColor: ["#007AFF", "#0A84FF"],
  systemBrownColor: ["#A2845E", "#AC8E68"],
  systemGrayColor: ["#8E8E93", "#98989D"],
  systemGreenColor: ["#28CD41", "#32D74B"],
  systemIndigoColor: ["#5856D6", "#5E5CE6"],
  systemOrangeColor: ["#FF9500", "#FF9F0A"],
  systemPinkColor: ["#FF2D55", "#FF375F"],
  systemPurpleColor: ["#AF52DE", "#BF5AF2"],
  systemRedColor: ["#FF3B30", "#FF453A"],
  systemTealColor: ["#55BEF0", "#5AC8F5"],
  systemYellowColor: ["#FFCC00", "#FFD60A"],
  systemFillColor: ["rgba(0,0,0,0.1)", "rgba(255,255,255,0.1)"],
  secondarySystemFillColor: ["rgba(0,0,0,0.08)", "rgba(255,255,255,0.08)"],
  tertiarySystemFillColor: ["rgba(0,0,0,0.05)", "rgba(255,255,255,0.05)"],
};

const isDark = () => Appearance.getColorScheme() === "dark";

export function resolvePlatformColor(name: string): string | null {
  const pair = systemColors[name] ?? systemColors[`${name}Color`];
  return pair ? pair[isDark() ? 1 : 0] : null;
}

export function PlatformColor(...names: string[]): string {
  for (const name of names) {
    const color = resolvePlatformColor(name);
    if (color) return color;
  }
  return isDark() ? "#FFFFFF" : "#000000";
}

type DynamicColorTuple = { light: unknown; dark: unknown; highContrastLight?: unknown; highContrastDark?: unknown };

export function DynamicColorMacOS(tuple: DynamicColorTuple): unknown {
  return isDark() ? tuple.dark : tuple.light;
}

export function ColorWithSystemEffectMacOS(color: unknown, _effect: string): unknown {
  return color;
}
