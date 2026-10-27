/**
 * Versioned, JSON-serializable document model.
 *
 * Design rules (see docs/architecture/adr/0002-document-model.md):
 *  - Plain JSON only: no classes, functions, Dates, or undefined values.
 *  - Every block-level node has a stable `id` (needed for comments, collab, diffing).
 *  - Documents are organised into sections, mirroring DOCX/PDF page semantics.
 *  - Comments and revisions live at document level; text refers to them via marks.
 */

/** Current schema version written by this build. Bump + add a migration on every breaking change. */
export const SCHEMA_VERSION = 1 as const;

export type NodeId = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Attrs = Record<string, JsonValue>;

// ---------------------------------------------------------------- marks

/** Built-in mark names. Plugins may add more through `Schema.extend`. */
export type CoreMarkType =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "superscript"
  | "subscript"
  | "link"
  | "textStyle"
  | "highlight"
  | "comment"
  | "insertion"
  | "deletion";

export interface Mark {
  type: string;
  attrs?: Attrs;
}

// ---------------------------------------------------------------- nodes

export type CoreInlineType = "text" | "hardBreak" | "placeholder" | "pageNumber" | "pageCount";

export type CoreBlockType =
  | "paragraph"
  | "heading"
  | "blockquote"
  | "codeBlock"
  | "horizontalRule"
  | "pageBreak"
  | "image"
  | "bulletList"
  | "orderedList"
  | "listItem"
  | "table"
  | "tableRow"
  | "tableCell";

export interface TextNode {
  type: "text";
  text: string;
  marks?: Mark[];
}

export interface InlineNode {
  type: Exclude<string, "text">;
  attrs?: Attrs;
}

export type Inline = TextNode | InlineNode;

export interface BlockNode {
  type: string;
  id: NodeId;
  attrs?: Attrs;
  /** Child blocks (container nodes) or inline nodes (textblocks). */
  content?: Array<BlockNode | Inline>;
}

// ---------------------------------------------------------------- page / sections

export interface PageSize {
  /** Width in twips (1/1440 inch), the unit used by DOCX. */
  width: number;
  height: number;
}

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
  header: number;
  footer: number;
}

export interface PageSetup {
  size: PageSize;
  orientation: "portrait" | "landscape";
  margins: PageMargins;
}

export interface Section {
  id: NodeId;
  /** `canvas` sections are manual-design pages whose blocks are placed freely (positionX/positionY). Default: `flow`. */
  kind?: "flow" | "canvas";
  page: PageSetup;
  /** Header/footer for the whole section. Different first/even pages are a later-stage extension. */
  header?: BlockNode[];
  footer?: BlockNode[];
  content: BlockNode[];
}

// ---------------------------------------------------------------- annotations

export interface CommentReply {
  id: string;
  authorId: string;
  createdAt: string; // ISO-8601
  body: string;
}

export interface Comment {
  id: string;
  authorId: string;
  createdAt: string;
  body: string;
  resolved: boolean;
  replies: CommentReply[];
}

export type RevisionKind = "insertion" | "deletion" | "format" | "move";

export interface Revision {
  id: string;
  kind: RevisionKind;
  authorId: string;
  createdAt: string;
  status: "pending" | "accepted" | "rejected";
}

// ---------------------------------------------------------------- document

export interface DocumentMeta {
  title: string;
  language?: string;
  createdAt: string;
  updatedAt: string;
  /** Free-form, app-owned data. Core never interprets it. */
  custom?: Attrs;
}

export interface DocumentJSON {
  schemaVersion: number;
  id: string;
  meta: DocumentMeta;
  sections: Section[];
  comments: Record<string, Comment>;
  revisions: Record<string, Revision>;
}

// ---------------------------------------------------------------- helpers

export function isTextNode(n: BlockNode | Inline): n is TextNode {
  return n.type === "text";
}

export function isBlockNode(n: BlockNode | Inline): n is BlockNode {
  return typeof (n as BlockNode).id === "string";
}
