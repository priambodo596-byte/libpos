import type { DocumentJSON } from "./types";

/**
 * Maximum JSON nesting depth `cloneJson` accepts. Also what stops cyclic structures: a cycle
 * keeps getting deeper until it hits this limit. 512 levels is far beyond any real document
 * (a node uses two levels: the node object and its `content` array).
 */
const MAX_CLONE_DEPTH = 512;

/**
 * Deep clone for plain-JSON values. Used instead of `structuredClone` so the core has no
 * dependency on a specific runtime (browser, Node, workers, React Native, ...).
 * Non-JSON values (functions, symbols, class instances) are not supported and are copied as-is.
 *
 * Throws `RangeError` when the value is nested deeper than 512 levels or contains a cycle.
 * An own `__proto__` key (which `JSON.parse` can produce) is copied as ordinary data and never
 * changes the prototype of the copy.
 */
export function cloneJson<T>(value: T): T {
  return cloneAt(value, 0) as T;
}

function cloneAt(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_CLONE_DEPTH) {
    throw new RangeError(`cloneJson: value is nested deeper than ${MAX_CLONE_DEPTH} levels or contains a cycle`);
  }
  if (Array.isArray(value)) return value.map((v) => cloneAt(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const copy = cloneAt(v, depth + 1);
    if (k === "__proto__") Object.defineProperty(out, k, { value: copy, enumerable: true, writable: true, configurable: true });
    else out[k] = copy;
  }
  return out;
}

export function cloneDocument(doc: DocumentJSON): DocumentJSON {
  return cloneJson(doc);
}
