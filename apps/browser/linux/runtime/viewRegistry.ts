import type { ComponentType } from "react";

export type ViewManagerComponent = ComponentType<Record<string, unknown>>;

const managers = new Map<string, ViewManagerComponent>();

export function registerViewManager(name: string, component: ViewManagerComponent) {
  managers.set(name, component);
}

export function viewManager(name: string): ViewManagerComponent | undefined {
  return managers.get(name);
}

export function viewManagerNames(): string[] {
  return [...managers.keys()];
}
