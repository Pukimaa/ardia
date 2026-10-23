import { createElement, forwardRef } from "react";
import { View } from "react-native-web";
import { moduleSpec } from "../moduleSpec.generated";
import { registerViewManager, viewManager } from "../viewRegistry";

export const placeholderManagers: string[] = [];

for (const [name, spec] of Object.entries(moduleSpec)) {
  if (!spec.view || viewManager(name)) continue;
  placeholderManagers.push(name);
  const Placeholder = forwardRef<unknown, Record<string, unknown>>(function Placeholder({ style, children, pointerEvents }, ref) {
    return createElement(View, { ref, style, pointerEvents, dataSet: { placeholderView: name } }, children as never);
  });
  registerViewManager(name, Placeholder as never);
}
