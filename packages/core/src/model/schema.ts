import {
  SCHEMA_VERSION,
  isBlockNode,
  type Attrs,
  type BlockNode,
  type DocumentJSON,
  type Inline,
  type JsonValue,
  type Mark,
  type PageSetup,
  type TextNode,
} from "./types";

// ------------------------------------------------------------------ spec types

export interface AttrSpec {
  default?: JsonValue;
  /** Required attrs have no usable default and must be present. */
  required?: boolean;
  validate?: (value: JsonValue) => boolean;
}

export interface ContentRule {
  children: "none" | "inline" | "block";
  /** Node names or group names that are allowed as children. Omitted = any node of the right kind. */
  allow?: readonly string[];
  /** Minimum number of children. */
  min?: number;
}

export interface NodeSpec {
  name: string;
  kind: "block" | "inline";
  groups?: readonly string[];
  content: ContentRule;
  attrs?: Record<string, AttrSpec>;
  /** Which marks text children may carry. Default "all". */
  marks?: "all" | readonly string[];
}

export interface MarkSpec {
  name: string;
  attrs?: Record<string, AttrSpec>;
  /** Attribute that must reference an id in a document-level collection. */
  references?: { attr: string; collection: "comments" | "revisions" };
}

export interface SchemaExtension {
  nodes?: readonly NodeSpec[];
  marks?: readonly MarkSpec[];
}

export type IssueCode =
  | "unsupported-version"
  | "malformed"
  | "unknown-node"
  | "unknown-mark"
  | "misplaced-node"
  | "invalid-content"
  | "unknown-attr"
  | "missing-attr"
  | "invalid-attr"
  | "non-json"
  | "duplicate-id"
  | "dangling-reference"
  | "duplicate-mark"
  | "invalid-page"
  | "too-deep";

export interface ValidationIssue {
  code: IssueCode;
  /** Location such as `sections[0].content[2].content[1]`. */
  path: string;
  message: string;
}

// ------------------------------------------------------------------ helpers

const isString = (v: JsonValue): v is string => typeof v === "string";
const isNonEmptyString = (v: JsonValue): boolean => typeof v === "string" && v.length > 0;
const isPositiveInt = (v: JsonValue): boolean => typeof v === "number" && Number.isInteger(v) && v > 0;
const isPositiveNumber = (v: JsonValue): boolean => typeof v === "number" && Number.isFinite(v) && v > 0;
const isNonNegativeNumber = (v: JsonValue): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;

function isJsonValue(v: unknown, depth = 0): v is JsonValue {
  if (depth > 64) return false;
  if (v === null) return true;
  switch (typeof v) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(v);
    case "object": {
      if (Array.isArray(v)) return v.every((x) => isJsonValue(x, depth + 1));
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return false;
      return Object.values(v as Record<string, unknown>).every((x) => isJsonValue(x, depth + 1));
    }
    default:
      return false;
  }
}

/** Deepest node nesting `validate` accepts; deeper structures are reported as `too-deep`. */
export const MAX_NODE_DEPTH = 100;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

type AddIssue = (code: IssueCode, path: string, message: string) => void;

function checkStringFields(rec: Record<string, unknown>, fields: readonly string[], path: string, label: string, add: AddIssue): void {
  for (const f of fields) if (typeof rec[f] !== "string") add("malformed", `${path}.${f}`, `${label} ${f} must be a string`);
}

const REVISION_KINDS: readonly string[] = ["insertion", "deletion", "format", "move"];
const REVISION_STATUSES: readonly string[] = ["pending", "accepted", "rejected"];

function checkComments(comments: unknown, add: AddIssue): void {
  if (!isRecord(comments)) return;
  for (const [key, c] of Object.entries(comments)) {
    const path = `comments.${key}`;
    if (!isRecord(c)) {
      add("malformed", path, "Comment must be an object");
      continue;
    }
    if (c["id"] !== key) add("malformed", path, `Comment key "${key}" does not match its id "${String(c["id"])}"`);
    checkStringFields(c, ["authorId", "createdAt", "body"], path, "Comment", add);
    if (typeof c["resolved"] !== "boolean") add("malformed", `${path}.resolved`, "Comment resolved must be a boolean");
    const replies = c["replies"];
    if (!Array.isArray(replies)) {
      add("malformed", `${path}.replies`, "Comment replies must be an array");
      continue;
    }
    replies.forEach((r: unknown, i) => {
      const rpath = `${path}.replies[${i}]`;
      if (!isRecord(r)) add("malformed", rpath, "Reply must be an object");
      else checkStringFields(r, ["id", "authorId", "createdAt", "body"], rpath, "Reply", add);
    });
  }
}

function checkRevisions(revisions: unknown, add: AddIssue): void {
  if (!isRecord(revisions)) return;
  for (const [key, r] of Object.entries(revisions)) {
    const path = `revisions.${key}`;
    if (!isRecord(r)) {
      add("malformed", path, "Revision must be an object");
      continue;
    }
    if (r["id"] !== key) add("malformed", path, `Revision key "${key}" does not match its id "${String(r["id"])}"`);
    checkStringFields(r, ["authorId", "createdAt"], path, "Revision", add);
    if (typeof r["kind"] !== "string" || !REVISION_KINDS.includes(r["kind"])) add("malformed", `${path}.kind`, "Revision kind is not valid");
    if (typeof r["status"] !== "string" || !REVISION_STATUSES.includes(r["status"])) add("malformed", `${path}.status`, "Revision status is not valid");
  }
}

// ------------------------------------------------------------------ core specs

const optionalString: AttrSpec = { validate: isString };

export const CORE_NODE_SPECS: readonly NodeSpec[] = [
  { name: "text", kind: "inline", content: { children: "none" } },
  { name: "hardBreak", kind: "inline", content: { children: "none" } },
  {
    name: "placeholder",
    kind: "inline",
    content: { children: "none" },
    attrs: { key: { required: true, validate: isNonEmptyString }, fallback: optionalString },
  },
  { name: "pageNumber", kind: "inline", content: { children: "none" } },
  { name: "pageCount", kind: "inline", content: { children: "none" } },

  {
    name: "paragraph",
    kind: "block",
    groups: ["block"],
    content: { children: "inline" },
    attrs: {
      // Manual-design canvas text box: CSS px (96 dpi) from the page's top-left edge. Both positionX and positionY
      // must be present for the paragraph to leave normal flow; boxWidth (px) optionally fixes the box width.
      positionX: { validate: isNonNegativeNumber },
      positionY: { validate: isNonNegativeNumber },
      boxWidth: { validate: isPositiveNumber },
      align: { default: "left", validate: (v) => ["left", "center", "right", "justify"].includes(v as string) },
      spacingBefore: { validate: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 },
      spacingAfter: { validate: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 },
      lineSpacing: { validate: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 },
      lineSpacingRule: { validate: (v) => ["auto", "exact", "atLeast"].includes(v as string) },
      indentLeft: { validate: (v) => typeof v === "number" && Number.isFinite(v) },
      indentRight: { validate: (v) => typeof v === "number" && Number.isFinite(v) },
      firstLineIndent: { validate: (v) => typeof v === "number" && Number.isFinite(v) },
      hangingIndent: { validate: (v) => typeof v === "number" && Number.isFinite(v) },
      styleId: optionalString,
      styleName: optionalString,
      styleBasedOn: optionalString,
    },
  },
  {
    name: "heading",
    kind: "block",
    groups: ["block"],
    content: { children: "inline" },
    attrs: {
      level: { required: true, validate: (v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 6 },
      align: { default: "left", validate: (v) => ["left", "center", "right", "justify"].includes(v as string) },
      spacingBefore: { validate: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 },
      spacingAfter: { validate: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 },
      lineSpacing: { validate: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 },
      lineSpacingRule: { validate: (v) => ["auto", "exact", "atLeast"].includes(v as string) },
      indentLeft: { validate: (v) => typeof v === "number" && Number.isFinite(v) },
      indentRight: { validate: (v) => typeof v === "number" && Number.isFinite(v) },
      firstLineIndent: { validate: (v) => typeof v === "number" && Number.isFinite(v) },
      hangingIndent: { validate: (v) => typeof v === "number" && Number.isFinite(v) },
      styleId: optionalString,
      styleName: optionalString,
      styleBasedOn: optionalString,
    },
  },
  { name: "blockquote", kind: "block", groups: ["block"], content: { children: "block", allow: ["block"], min: 1 } },
  {
    name: "codeBlock",
    kind: "block",
    groups: ["block"],
    content: { children: "inline", allow: ["text"] },
    attrs: { language: optionalString },
    marks: [],
  },
  { name: "horizontalRule", kind: "block", groups: ["block"], content: { children: "none" } },
  { name: "pageBreak", kind: "block", groups: ["block"], content: { children: "none" } },
  {
    name: "image",
    kind: "block",
    groups: ["block"],
    content: { children: "none" },
    attrs: {
      src: { required: true, validate: isNonEmptyString },
      alt: optionalString,
      width: { validate: isPositiveNumber },
      height: { validate: isPositiveNumber },
      align: { default: "center", validate: (v) => ["left", "center", "right"].includes(v as string) },
      // Free positioning in CSS px (96 dpi) measured from the top-left corner of the page edge (not the content area).
      // Both must be present for the image to leave normal flow; absent attributes keep the legacy flow/align layout.
      positionX: { validate: isNonNegativeNumber },
      positionY: { validate: isNonNegativeNumber },
    },
  },
  { name: "bulletList", kind: "block", groups: ["block"], content: { children: "block", allow: ["listItem"], min: 1 } },
  {
    name: "orderedList",
    kind: "block",
    groups: ["block"],
    content: { children: "block", allow: ["listItem"], min: 1 },
    attrs: { start: { default: 1, validate: isPositiveInt } },
  },
  { name: "listItem", kind: "block", content: { children: "block", allow: ["block"], min: 1 } },
  { name: "table", kind: "block", groups: ["block"], content: { children: "block", allow: ["tableRow"], min: 1 }, attrs: { width: { validate: isPositiveNumber }, layout: { validate: (v) => v === "fixed" || v === "autofit" } } },
  { name: "tableRow", kind: "block", content: { children: "block", allow: ["tableCell"], min: 1 }, attrs: { height: { validate: isPositiveNumber } } },
  {
    name: "tableCell",
    kind: "block",
    content: { children: "block", allow: ["block"], min: 1 },
    attrs: {
      colspan: { default: 1, validate: isPositiveInt },
      rowspan: { default: 1, validate: isPositiveInt },
      width: { validate: isPositiveNumber },
      backgroundColor: { validate: (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) },
      verticalAlign: { validate: (v) => v === "top" || v === "center" || v === "bottom" },
      borderTop: optionalString,
      borderRight: optionalString,
      borderBottom: optionalString,
      borderLeft: optionalString,
    },
  },
];

export const CORE_MARK_SPECS: readonly MarkSpec[] = [
  { name: "bold" },
  { name: "italic" },
  { name: "underline" },
  { name: "strike" },
  { name: "code" },
  { name: "superscript" },
  { name: "subscript" },
  { name: "link", attrs: { href: { required: true, validate: isNonEmptyString }, title: optionalString } },
  { name: "textStyle", attrs: { color: optionalString, fontFamily: optionalString, fontSize: { validate: isPositiveNumber } } },
  { name: "highlight", attrs: { color: optionalString } },
  {
    name: "comment",
    attrs: { commentId: { required: true, validate: isNonEmptyString } },
    references: { attr: "commentId", collection: "comments" },
  },
  {
    name: "insertion",
    attrs: { revisionId: { required: true, validate: isNonEmptyString } },
    references: { attr: "revisionId", collection: "revisions" },
  },
  {
    name: "deletion",
    attrs: { revisionId: { required: true, validate: isNonEmptyString } },
    references: { attr: "revisionId", collection: "revisions" },
  },
];

// ------------------------------------------------------------------ Schema

interface Ctx {
  doc: DocumentJSON;
  ids: Set<string>;
  issues: ValidationIssue[];
}

/**
 * Immutable registry of node and mark specs plus a structural validator.
 * Plugins extend a schema by producing a new one via `extend`; the original is never mutated.
 */
export class Schema {
  private constructor(
    private readonly nodes: ReadonlyMap<string, NodeSpec>,
    private readonly marks: ReadonlyMap<string, MarkSpec>,
  ) {}

  static create(extension: SchemaExtension = {}): Schema {
    return new Schema(new Map(), new Map()).extend({
      nodes: [...CORE_NODE_SPECS, ...(extension.nodes ?? [])],
      marks: [...CORE_MARK_SPECS, ...(extension.marks ?? [])],
    });
  }

  extend(extension: SchemaExtension): Schema {
    const nodes = new Map(this.nodes);
    const marks = new Map(this.marks);
    for (const n of extension.nodes ?? []) {
      if (nodes.has(n.name)) throw new Error(`Schema: duplicate node spec "${n.name}"`);
      nodes.set(n.name, n);
    }
    for (const m of extension.marks ?? []) {
      if (marks.has(m.name)) throw new Error(`Schema: duplicate mark spec "${m.name}"`);
      marks.set(m.name, m);
    }
    return new Schema(nodes, marks);
  }

  node(name: string): NodeSpec | undefined {
    return this.nodes.get(name);
  }
  mark(name: string): MarkSpec | undefined {
    return this.marks.get(name);
  }
  nodeNames(): string[] {
    return [...this.nodes.keys()];
  }
  markNames(): string[] {
    return [...this.marks.keys()];
  }

  /** Structural validation. Returns an empty array when the document is valid. */
  validate(doc: DocumentJSON): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const add = (code: IssueCode, path: string, message: string) => issues.push({ code, path, message });

    if (typeof doc !== "object" || doc === null) {
      add("malformed", "", "Document must be an object");
      return issues;
    }
    if (doc.schemaVersion !== SCHEMA_VERSION) {
      add("unsupported-version", "schemaVersion", `Expected schemaVersion ${SCHEMA_VERSION}, got ${String(doc.schemaVersion)}`);
      return issues;
    }
    if (typeof doc.id !== "string" || doc.id.length === 0) add("malformed", "id", "Document id must be a non-empty string");
    if (typeof doc.meta !== "object" || doc.meta === null || typeof doc.meta.title !== "string") {
      add("malformed", "meta", "meta.title must be a string");
    }
    if (!Array.isArray(doc.sections) || doc.sections.length === 0) {
      add("malformed", "sections", "A document needs at least one section");
      return issues;
    }
    if (typeof doc.comments !== "object" || doc.comments === null) add("malformed", "comments", "comments must be an object");
    if (typeof doc.revisions !== "object" || doc.revisions === null) add("malformed", "revisions", "revisions must be an object");

    checkComments(doc.comments, add);
    checkRevisions(doc.revisions, add);

    const ctx: Ctx = { doc, ids: new Set(), issues };
    const blocks: ContentRule = { children: "block", allow: ["block"] };

    doc.sections.forEach((section, i) => {
      const base = `sections[${i}]`;
      if (typeof section !== "object" || section === null) {
        add("malformed", base, "Section must be an object");
        return;
      }
      this.claimId(ctx, section.id, base);
      if (section.kind !== undefined && section.kind !== "flow" && section.kind !== "canvas") {
        add("malformed", `${base}.kind`, 'Section kind must be "flow" or "canvas"');
      }
      this.checkPage(section.page, `${base}.page`, ctx);
      if (section.header) this.checkChildren(ctx, "header", blocks, section.header, `${base}.header`);
      if (section.footer) this.checkChildren(ctx, "footer", blocks, section.footer, `${base}.footer`);
      this.checkChildren(ctx, "section", { ...blocks, min: 1 }, section.content, `${base}.content`);
    });

    return issues;
  }

  // ---------------------------------------------------------------- internals

  private claimId(ctx: Ctx, id: unknown, path: string): void {
    if (typeof id !== "string" || id.length === 0) {
      ctx.issues.push({ code: "malformed", path: `${path}.id`, message: "id must be a non-empty string" });
      return;
    }
    if (ctx.ids.has(id)) ctx.issues.push({ code: "duplicate-id", path: `${path}.id`, message: `Duplicate id "${id}"` });
    ctx.ids.add(id);
  }

  private checkPage(page: PageSetup | undefined, path: string, ctx: Ctx): void {
    const bad = (m: string): void => {
      ctx.issues.push({ code: "invalid-page", path, message: m });
    };
    if (!page) return bad("page setup is required");
    if (!isPositiveInt(page.size?.width) || !isPositiveInt(page.size?.height)) bad("size.width/height must be positive integers (twips)");
    if (page.orientation !== "portrait" && page.orientation !== "landscape") bad("orientation must be portrait or landscape");
    for (const k of ["top", "right", "bottom", "left", "header", "footer"] as const) {
      const v = page.margins?.[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) bad(`margins.${k} must be a non-negative number`);
    }
  }

  private matches(spec: NodeSpec, allow: readonly string[] | undefined): boolean {
    if (!allow) return true;
    return allow.includes(spec.name) || (spec.groups?.some((g) => allow.includes(g)) ?? false);
  }

  private checkAttrs(
    ctx: Ctx,
    specs: Record<string, AttrSpec> | undefined,
    attrs: Attrs | undefined,
    path: string,
    label: string,
  ): void {
    const known = specs ?? {};
    const given = attrs ?? {};
    for (const [key, value] of Object.entries(given)) {
      if (!isJsonValue(value)) {
        ctx.issues.push({ code: "non-json", path: `${path}.attrs.${key}`, message: `${label} attr "${key}" is not plain JSON` });
        continue;
      }
      const spec = hasOwn(known, key) ? known[key] : undefined;
      if (!spec) {
        ctx.issues.push({ code: "unknown-attr", path: `${path}.attrs.${key}`, message: `${label} has no attr "${key}"` });
      } else if (spec.validate && !spec.validate(value)) {
        ctx.issues.push({ code: "invalid-attr", path: `${path}.attrs.${key}`, message: `${label} attr "${key}" has an invalid value` });
      }
    }
    for (const [key, spec] of Object.entries(known)) {
      if (spec.required && given[key] === undefined) {
        ctx.issues.push({ code: "missing-attr", path: `${path}.attrs.${key}`, message: `${label} requires attr "${key}"` });
      }
    }
  }

  private checkChildren(
    ctx: Ctx,
    parentLabel: string,
    rule: ContentRule,
    children: ReadonlyArray<BlockNode | Inline> | undefined,
    path: string,
    parentMarks: "all" | readonly string[] = "all",
    depth = 0,
  ): void {
    if (depth > MAX_NODE_DEPTH) {
      ctx.issues.push({ code: "too-deep", path, message: `Content is nested deeper than ${MAX_NODE_DEPTH} levels` });
      return;
    }
    const list = children ?? [];
    if (!Array.isArray(list)) {
      ctx.issues.push({ code: "malformed", path, message: "content must be an array" });
      return;
    }
    if (rule.children === "none") {
      if (list.length > 0) ctx.issues.push({ code: "invalid-content", path, message: `${parentLabel} cannot have content` });
      return;
    }
    if (list.length < (rule.min ?? 0)) {
      ctx.issues.push({ code: "invalid-content", path, message: `${parentLabel} needs at least ${rule.min} child node(s)` });
    }

    list.forEach((child, i) => {
      const cpath = `${path}[${i}]`;
      const spec = this.nodes.get(child?.type);
      if (!spec) {
        ctx.issues.push({ code: "unknown-node", path: cpath, message: `Unknown node type "${String(child?.type)}"` });
        return;
      }
      if (spec.kind !== rule.children) {
        ctx.issues.push({ code: "misplaced-node", path: cpath, message: `"${spec.name}" is a ${spec.kind} node but ${parentLabel} expects ${rule.children} children` });
        return;
      }
      if (!this.matches(spec, rule.allow)) {
        ctx.issues.push({ code: "misplaced-node", path: cpath, message: `"${spec.name}" is not allowed inside ${parentLabel}` });
        return;
      }

      if (rule.children === "block") {
        if (!isBlockNode(child)) {
          ctx.issues.push({ code: "malformed", path: cpath, message: "block nodes need a string id" });
          return;
        }
        this.claimId(ctx, child.id, cpath);
        this.checkAttrs(ctx, spec.attrs, child.attrs, cpath, spec.name);
        this.checkChildren(ctx, spec.name, spec.content, child.content, `${cpath}.content`, spec.marks ?? "all", depth + 1);
      } else if (spec.name === "text") {
        this.checkText(ctx, child as TextNode, cpath, parentMarks);
      } else {
        this.checkAttrs(ctx, spec.attrs, (child as { attrs?: Attrs }).attrs, cpath, spec.name);
      }
    });
  }

  private checkText(ctx: Ctx, node: TextNode, path: string, allowed: "all" | readonly string[]): void {
    if (typeof node.text !== "string" || node.text.length === 0) {
      ctx.issues.push({ code: "invalid-content", path, message: "text nodes must contain a non-empty string" });
    }
    const seen = new Set<string>();
    if (node.marks !== undefined && !Array.isArray(node.marks)) {
      ctx.issues.push({ code: "malformed", path: `${path}.marks`, message: "marks must be an array" });
      return;
    }
    (node.marks ?? []).forEach((mark: Mark, i) => {
      const mpath = `${path}.marks[${i}]`;
      const spec = this.marks.get(mark?.type);
      if (!spec) {
        ctx.issues.push({ code: "unknown-mark", path: mpath, message: `Unknown mark "${String(mark?.type)}"` });
        return;
      }
      if (allowed !== "all" && !allowed.includes(spec.name)) {
        ctx.issues.push({ code: "misplaced-node", path: mpath, message: `Mark "${spec.name}" is not allowed here` });
      }
      if (seen.has(spec.name)) ctx.issues.push({ code: "duplicate-mark", path: mpath, message: `Duplicate mark "${spec.name}"` });
      seen.add(spec.name);
      this.checkAttrs(ctx, spec.attrs, mark.attrs, mpath, `mark "${spec.name}"`);
      if (spec.references) {
        const ref = mark.attrs?.[spec.references.attr];
        if (typeof ref === "string") {
          const collection: unknown = ctx.doc[spec.references.collection];
          if (!(isRecord(collection) && hasOwn(collection, ref))) {
            ctx.issues.push({ code: "dangling-reference", path: mpath, message: `Mark "${spec.name}" references missing ${spec.references.collection} entry "${ref}"` });
          }
        }
      }
    });
  }
}

/** Schema containing only the built-in nodes and marks. */
export const coreSchema: Schema = Schema.create();

