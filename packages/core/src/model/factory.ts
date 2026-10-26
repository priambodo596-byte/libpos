import {
  SCHEMA_VERSION,
  type Attrs,
  type BlockNode,
  type DocumentJSON,
  type Inline,
  type Mark,
  type PageSetup,
  type Section,
  type TextNode,
} from "./types";

/** Produces unique ids. Injectable so tests and collaboration layers can control id allocation. */
export type IdGenerator = () => string;

let fallbackCounter = 0;

/** Default generator: crypto.randomUUID when available, otherwise a process-local counter. */
export const defaultIdGenerator: IdGenerator = () => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  fallbackCounter += 1;
  return `id-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
};

/** Deterministic generator (`n1`, `n2`, ...). Intended for tests and fixtures. */
export function createSequentialIdGenerator(prefix = "n"): IdGenerator {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** A4 portrait, 1-inch margins, 0.5-inch header/footer distance. Units are twips. */
export function defaultPageSetup(): PageSetup {
  return {
    size: { width: 11906, height: 16838 },
    orientation: "portrait",
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 },
  };
}

type Content = string | Inline[];

function toInline(content: Content): Inline[] {
  if (typeof content === "string") return content.length === 0 ? [] : [{ type: "text", text: content }];
  return content;
}

/** Small helpers for building valid nodes. Every block created gets a fresh id from `nextId`. */
export function createNodeFactory(nextId: IdGenerator = defaultIdGenerator) {
  const block = (type: string, content?: BlockNode["content"], attrs?: Attrs): BlockNode => {
    const node: BlockNode = { type, id: nextId() };
    if (attrs) node.attrs = attrs;
    if (content && content.length > 0) node.content = content;
    return node;
  };

  const text = (value: string, marks?: Mark[]): TextNode => (marks && marks.length ? { type: "text", text: value, marks } : { type: "text", text: value });

  const paragraph = (content: Content = [], attrs?: Attrs) => block("paragraph", toInline(content), attrs);
  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6, content: Content) => block("heading", toInline(content), { level });
  const listItem = (content: string | BlockNode[]) => block("listItem", typeof content === "string" ? [paragraph(content)] : content);
  const bulletList = (items: Array<string | BlockNode[]>) => block("bulletList", items.map(listItem));
  const orderedList = (items: Array<string | BlockNode[]>, start = 1) => block("orderedList", items.map(listItem), { start });
  const table = (rows: string[][]) =>
    block(
      "table",
      rows.map((cells) => block("tableRow", cells.map((c) => block("tableCell", [paragraph(c)])))),
    );
  const image = (src: string, opts: { alt?: string; width?: number; height?: number; align?: "left" | "center" | "right" } = {}) => {
    const attrs: Attrs = { src };
    if (opts.alt !== undefined) attrs["alt"] = opts.alt;
    if (opts.width !== undefined) attrs["width"] = opts.width;
    if (opts.height !== undefined) attrs["height"] = opts.height;
    if (opts.align !== undefined) attrs["align"] = opts.align;
    return block("image", undefined, attrs);
  };
  const placeholder = (key: string, fallback?: string): Inline => ({
    type: "placeholder",
    attrs: fallback === undefined ? { key } : { key, fallback },
  });
  const pageBreak = () => block("pageBreak");
  const horizontalRule = () => block("horizontalRule");

  return { block, text, paragraph, heading, listItem, bulletList, orderedList, table, image, placeholder, pageBreak, horizontalRule };
}

export interface CreateDocumentOptions {
  id?: string;
  title?: string;
  language?: string;
  /** Blocks for the first section. Defaults to one empty paragraph. */
  content?: BlockNode[];
  page?: PageSetup;
  ids?: IdGenerator;
  /** ISO-8601 timestamp for createdAt/updatedAt. Defaults to the current time. */
  now?: string;
}

export function createSection(content: BlockNode[], opts: { id?: string; page?: PageSetup; ids?: IdGenerator } = {}): Section {
  const ids = opts.ids ?? defaultIdGenerator;
  return { id: opts.id ?? ids(), page: opts.page ?? defaultPageSetup(), content };
}

export function createDocument(opts: CreateDocumentOptions = {}): DocumentJSON {
  const ids = opts.ids ?? defaultIdGenerator;
  const now = opts.now ?? new Date().toISOString();
  const content = opts.content ?? [createNodeFactory(ids).paragraph()];
  const meta: DocumentJSON["meta"] = { title: opts.title ?? "Untitled", createdAt: now, updatedAt: now };
  if (opts.language !== undefined) meta.language = opts.language;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: opts.id ?? ids(),
    meta,
    sections: [createSection(content, { page: opts.page ?? defaultPageSetup(), ids })],
    comments: {},
    revisions: {},
  };
}
