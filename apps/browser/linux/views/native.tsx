import { createElement, forwardRef } from "react";
import { View } from "../runtime/reactNative";
import type { ViewProps } from "./common";
import { useNativeView } from "./nativeViews";

function nativeViewManager(manager: string, options: { track?: boolean; pointerEvents?: "none" | "box-none" } = {}) {
  const component = forwardRef<unknown, ViewProps>(function NativeView(props, ref) {
    const { element, rest } = useNativeView(manager, props, ref, { track: options.track });
    return createElement(View, {
      ...rest,
      ref: element,
      pointerEvents: rest.pointerEvents ?? options.pointerEvents,
      dataSet: { ...(rest.dataSet as object), ardiaNativeView: manager },
    });
  });
  component.displayName = manager;
  return component;
}

export const CEFView = nativeViewManager("ArdiaCEF");
export const SwipeView = nativeViewManager("ArdiaSwipe");
export const WindowProfileView = nativeViewManager("ArdiaWindowProfile", { track: false, pointerEvents: "none" });
