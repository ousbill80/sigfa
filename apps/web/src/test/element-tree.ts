/**
 * Test helpers — React element tree inspection without rendering.
 *
 * Server components are plain async functions returning element trees; these
 * helpers walk the returned tree to assert what props reach client components
 * (S2: no JWT serialized towards public routes' client tree).
 * @module test/element-tree
 */
import type { ReactElement, ReactNode } from "react";

/** Élément dont les props sont inspectables par les tests. */
export type InspectableElement = ReactElement<Record<string, unknown>>;

/** Loose element shape (enough for tree walking). */
interface ElementLike {
  type?: unknown;
  props?: Record<string, unknown>;
}

function isElementLike(node: unknown): node is ElementLike {
  return typeof node === "object" && node !== null && "props" in node;
}

/**
 * Depth-first search for the first element of the given type.
 * @param node - Root of the element tree.
 * @param type - Component function / tag to find.
 * @returns The matching element, or null.
 */
export function findElementByType(node: ReactNode, type: unknown): InspectableElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByType(child as ReactNode, type);
      if (found) return found;
    }
    return null;
  }
  if (!isElementLike(node)) return null;
  if (node.type === type) return node as unknown as InspectableElement;
  const children = node.props?.["children"] as ReactNode | undefined;
  return children === undefined ? null : findElementByType(children, type);
}

/**
 * Deeply scans every prop value of the tree for an exact string value.
 * Used to prove a JWT is (not) serialized anywhere in a server tree (S2).
 * @param node - Root of the element tree.
 * @param value - Exact string to look for.
 * @returns true if any prop value (recursively) equals the string.
 */
export function treeContainsString(node: unknown, value: string): boolean {
  if (typeof node === "string") return node === value;
  if (Array.isArray(node)) return node.some((child) => treeContainsString(child, value));
  if (typeof node !== "object" || node === null) return false;
  const props = (node as ElementLike).props;
  if (!props) return false;
  return Object.values(props).some((propValue) => treeContainsString(propValue, value));
}
