import { useRef } from "react";
import { adoptWindow } from "../windowHub";
import { AppRegistry, findNodeHandle, PanResponder, Pressable, Text, TextInput, View } from "react-native";

type ProbeLog = { events: string[]; layout: { width: number; height: number } | null; tag: number | null };

declare global {
  interface Window {
    __ardiaCompatProbe?: (win: Window) => ProbeLog;
  }
}

function Probe({ log }: { log: ProbeLog }) {
  const keys = useRef<View>(null);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => log.events.push("pan:grant"),
      onPanResponderMove: (_event, gesture) => log.events.push(`pan:move:${Math.round(gesture.dx)}`),
      onPanResponderRelease: () => log.events.push("pan:release"),
    }),
  ).current;
  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }} onLayout={(event) => (log.layout = event.nativeEvent.layout)}>
      <View
        ref={(node) => {
          keys.current = node;
          log.tag = findNodeHandle(node);
        }}
        testID="keys"
        focusable
        enableFocusRing={false}
        keyDownEvents={[{ key: "Escape" }, { key: "Enter", shiftKey: true }]}
        onKeyDown={(event) => log.events.push(`view:${event.nativeEvent.key}:${(event.nativeEvent as { target?: number }).target === findNodeHandle(keys.current)}`)}
        tooltip="Probe tooltip"
        style={{ height: 40, backgroundColor: "#ddd" }}
      />
      <TextInput
        testID="field"
        keyDownEvents={[{ key: "ArrowDown" }, { key: "Enter", metaKey: true }]}
        onKeyDown={(event) => log.events.push(`input:${event.nativeEvent.key}`)}
        onSubmitEditing={() => log.events.push("input:submit")}
        style={{ height: 30, borderWidth: 1 }}
      />
      <View testID="pan" {...pan.panHandlers} style={{ height: 60, backgroundColor: "#bbb" }} />
      <Pressable testID="press" onPress={() => log.events.push("press")} onDoubleClick={() => log.events.push("doubleClick")}>
        <Text>Press</Text>
      </Pressable>
    </View>
  );
}

AppRegistry.registerComponent("ardia-compat-probe", () => Probe);

window.__ardiaCompatProbe = (win) => {
  const log: ProbeLog = { events: [], layout: null, tag: null };
  const rootTag = win.document.getElementById("root");
  adoptWindow(win);
  AppRegistry.runApplication("ardia-compat-probe", { rootTag, initialProps: { log } });
  return log;
};
