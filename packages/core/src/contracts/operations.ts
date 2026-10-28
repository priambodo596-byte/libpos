import type {
  Attrs,
  BlockNode,
  Comment,
  DocumentMeta,
  InlineNode,
  Mark,
  NodeId,
  PageSetup,
  Revision,
  Section,
} from "../model/types";

/**
 * Operations: the single, JSON-serialisable change format (see ADR 0003).
 * Everything that modifies a document (commands, plugins, import, collaboration, undo,
 * track changes) is expressed as a Transaction of these operations.
 */

/** A point inside a textblock. `offset` counts characters of text plus 1 per inline atom. */
export interface Position {
  readonly blockId: NodeId;
  readonly offset: number;
}

export interface Selection {
  readonly anchor: Position;
  readonly head: Position;
}

export type ParentRef =
  | { readonly kind: "section"; readonly id: NodeId; readonly slot?: "content" | "header" | "footer" | "firstPageHeader" | "firstPageFooter" | "evenPageHeader" | "evenPageFooter" }
  | { readonly kind: "node"; readonly id: NodeId };

export interface InsertTextOp {
  readonly type: "insert_text";
  readonly at: Position;
  readonly text: string;
  readonly marks?: readonly Mark[];
}
export interface DeleteTextOp {
  readonly type: "delete_text";
  readonly blockId: NodeId;
  readonly from: number;
  readonly to: number;
}
export interface FormatOp {
  readonly type: "format";
  readonly blockId: NodeId;
  readonly from: number;
  readonly to: number;
  readonly mark: Mark;
  readonly action: "add" | "remove";
}
export interface InsertInlineOp {
  readonly type: "insert_inline";
  readonly at: Position;
  readonly node: InlineNode;
}
export interface InsertBlockOp {
  readonly type: "insert_block";
  readonly parent: ParentRef;
  readonly index: number;
  readonly node: BlockNode;
}
export interface RemoveBlockOp {
  readonly type: "remove_block";
  readonly id: NodeId;
}
export interface SetAttrsOp {
  readonly type: "set_attrs";
  readonly id: NodeId;
  readonly set?: Attrs;
  readonly unset?: readonly string[];
}
/** Changes a block's type while preserving its stable id and inline content. */
export interface SetNodeTypeOp {
  readonly type: "set_node_type";
  readonly id: NodeId;
  readonly nodeType: string;
  readonly attrs?: Attrs;
}
/** Splits a textblock at `offset`; the second half becomes a new block with id `newId`. */
export interface SplitBlockOp {
  readonly type: "split_block";
  readonly id: NodeId;
  readonly offset: number;
  readonly newId: NodeId;
}
/** Appends the content of `secondId` to `firstId` and removes `secondId`. */
export interface JoinBlocksOp {
  readonly type: "join_blocks";
  readonly firstId: NodeId;
  readonly secondId: NodeId;
}
export interface InsertSectionOp {
  readonly type: "insert_section";
  readonly index: number;
  readonly section: Section;
}
export interface RemoveSectionOp {
  readonly type: "remove_section";
  readonly id: NodeId;
}
export interface SetPageOp {
  readonly type: "set_page";
  readonly sectionId: NodeId;
  readonly page: PageSetup;
}
export interface SetMetaOp {
  readonly type: "set_meta";
  readonly set: Partial<Pick<DocumentMeta, "title" | "language" | "custom">>;
}
export interface PutCommentOp {
  readonly type: "put_comment";
  readonly comment: Comment;
}
export interface RemoveCommentOp {
  readonly type: "remove_comment";
  readonly id: string;
}
export interface PutRevisionOp {
  readonly type: "put_revision";
  readonly revision: Revision;
}
export interface SetRevisionStatusOp {
  readonly type: "set_revision_status";
  readonly id: string;
  readonly status: Revision["status"];
}

export type Operation =
  | InsertTextOp
  | DeleteTextOp
  | FormatOp
  | InsertInlineOp
  | InsertBlockOp
  | RemoveBlockOp
  | SetAttrsOp
  | SetNodeTypeOp
  | SplitBlockOp
  | JoinBlocksOp
  | InsertSectionOp
  | RemoveSectionOp
  | SetPageOp
  | SetMetaOp
  | PutCommentOp
  | RemoveCommentOp
  | PutRevisionOp
  | SetRevisionStatusOp;

export type OperationType = Operation["type"];

export interface TransactionMeta {
  /** Who/what produced it, e.g. "command:text.toggleBold", "import:docx", "collab:remote". */
  readonly origin?: string;
  readonly authorId?: string;
  /** ISO-8601. */
  readonly timestamp?: string;
  /** Whether undo history should record it. Default true. */
  readonly addToHistory?: boolean;
  /** App/plugin-owned data. Core never interprets it. */
  readonly custom?: Attrs;
}

/** An ordered list of operations applied atomically: all succeed or none are applied. */
export interface Transaction {
  readonly id: string;
  readonly ops: readonly Operation[];
  /** Selection to set after applying. Omitted = keep and map the current selection. */
  readonly selection?: Selection | null;
  /** Document version this transaction was built against (used by collaboration). */
  readonly baseVersion?: number;
  readonly meta: TransactionMeta;
}
