const tagsByNode = new WeakMap<object, number>();
const nodesByTag = new Map<number, WeakRef<Element>>();
let nextTag = 2;

const isElement = (value: unknown): value is Element =>
  value != null && typeof value === "object" && (value as Node).nodeType === 1;

export function tagOf(node: Element): number {
  let tag = tagsByNode.get(node);
  if (tag == null) {
    tag = nextTag;
    nextTag += 2;
    tagsByNode.set(node, tag);
    nodesByTag.set(tag, new WeakRef(node));
    if (nodesByTag.size % 512 === 0) for (const [key, ref] of nodesByTag) if (!ref.deref()) nodesByTag.delete(key);
  }
  return tag;
}

export function nodeForTag(tag: number): Element | null {
  const node = nodesByTag.get(tag)?.deref() ?? null;
  if (!node) nodesByTag.delete(tag);
  return node;
}

export function findNodeHandle(component: unknown): number | null {
  if (component == null) return null;
  if (typeof component === "number") return component;
  if (isElement(component)) return tagOf(component);
  const host = (component as { getNativeRef?: () => unknown }).getNativeRef?.();
  return isElement(host) ? tagOf(host) : null;
}
