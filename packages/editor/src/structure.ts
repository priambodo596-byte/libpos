import { cloneJson } from "@convetlib/core";
import type { BlockNode, EditorState, Inline, Mark, Operation, Position } from "@convetlib/core";

/**
 * Structural helpers for selections and edits that cross parent boundaries
 * (list items, blockquotes, table cells, nested lists, ...).
 *
 * Rules implemented by `planCrossBlockEdit`:
 *  - Both selection endpoints must be text blocks in the same section and slot
 *    (content, header or footer). Anything else is unsupported and yields no plan.
 *  - Text inside the selection is deleted at both ends. Blocks fully inside the selection are
 *    removed, except table rows/cells, which are emptied instead so the table grid survives.
 *  - The remainder of the end block is merged into the start block only when that keeps the
 *    structure valid and unsurprising: same table ancestry, compatible block kinds, and every
 *    container that would be left empty is one that may be removed (list item, blockquote,
 *    list). Otherwise the two blocks stay separate and only the selected text is deleted.
 *  The core engine still validates the resulting document, so an invalid plan is rejected
 *  atomically rather than corrupting the document.
 */

export type IdFactory = () => string;
type TextInline = Extract<Inline, { type: "text" }>;
type Slot = "content" | "header" | "footer";

const TEXT_BLOCK_TYPES: ReadonlySet<string> = new Set(["paragraph", "heading", "codeBlock"]);
/** Containers that may be deleted when they would otherwise be left without children. */
const REMOVABLE_CONTAINERS: ReadonlySet<string> = new Set(["listItem", "blockquote", "bulletList", "orderedList"]);
/** Containers whose shape is a grid; they are emptied, never removed or merged across. */
const FIXED_STRUCTURE: ReadonlySet<string> = new Set(["table", "tableRow", "tableCell"]);

export const isBlockNode = (n: BlockNode | Inline): n is BlockNode => typeof (n as BlockNode).id === "string";
export const isTextInline = (n: Inline): n is TextInline => n.type === "text" && typeof (n as { text?: unknown }).text === "string";

function childBlocks(block: BlockNode): BlockNode[] | undefined {
  const content = block.content;
  return content && content.some(isBlockNode) ? (content as BlockNode[]) : undefined;
}

export function isTextBlock(block: BlockNode): boolean {
  return TEXT_BLOCK_TYPES.has(block.type) && childBlocks(block) === undefined;
}

export function textLength(block: BlockNode): number {
  let total = 0;
  for (const node of block.content ?? []) {
    if (isBlockNode(node)) continue;
    total += isTextInline(node) ? node.text.length : 1;
  }
  return total;
}

export interface BlockLocation {
  readonly sectionIndex: number;
  readonly slot: Slot;
  /** Ancestors from the slot root down to the block itself (last element). */
  readonly chain: BlockNode[];
  /** `lists[k]` is the child list that contains `chain[k]`. */
  readonly lists: BlockNode[][];
}

function search(list: BlockNode[], id: string, chain: BlockNode[], lists: BlockNode[][]): { chain: BlockNode[]; lists: BlockNode[][] } | undefined {
  for (const node of list) {
    const nextChain = [...chain, node];
    const nextLists = [...lists, list];
    if (node.id === id) return { chain: nextChain, lists: nextLists };
    const kids = childBlocks(node);
    if (kids) {
      const found = search(kids, id, nextChain, nextLists);
      if (found) return found;
    }
  }
  return undefined;
}

export function locateBlock(state: EditorState, id: string): BlockLocation | undefined {
  const sections = state.document.sections;
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex]!;
    const slots: Array<[Slot, BlockNode[] | undefined]> = [
      ["content", section.content],
      ["header", section.header],
      ["footer", section.footer],
    ];
    for (const [slot, root] of slots) {
      if (!root) continue;
      const found = search(root, id, [], []);
      if (found) return { sectionIndex, slot, ...found };
    }
  }
  return undefined;
}

/** True when the selection exists and its endpoints are in different blocks. */
export function selectionSpansBlocks(state: EditorState): boolean {
  const s = state.selection;
  return !!s && s.anchor.blockId !== s.head.blockId;
}

export interface CrossBlockPlan {
  /** Operations to apply, in order. */
  readonly ops: Operation[];
  /** Where the caret belongs afterwards: the start of the former selection, after inserted text. */
  readonly caret: Position;
  /** Whether the remainder of the end block was merged into the start block. */
  readonly joined: boolean;
}

export interface CrossBlockOptions {
  /** Allocates ids for blocks created while emptying table cells. Called lazily. */
  readonly ids: IdFactory;
  /** Text to put in place of the selection. */
  readonly insertText?: string;
}

function disposeOps(block: BlockNode, ids: IdFactory): Operation[] {
  if (block.type === "tableRow") return (childBlocks(block) ?? []).flatMap((cell) => disposeOps(cell, ids));
  if (block.type === "tableCell") {
    const old = childBlocks(block) ?? [];
    const insert: Operation = { type: "insert_block", parent: { kind: "node", id: block.id }, index: 0, node: { type: "paragraph", id: ids() } };
    return [insert, ...old.map((child): Operation => ({ type: "remove_block", id: child.id }))];
  }
  return [{ type: "remove_block", id: block.id }];
}

/** Index in `end.chain` of the block to remove when merging, or undefined when merging is not allowed. */
function mergeTarget(start: BlockLocation, end: BlockLocation, depth: number): number | undefined {
  const sb = start.chain[start.chain.length - 1]!;
  const eb = end.chain[end.chain.length - 1]!;
  if ((sb.type === "codeBlock") !== (eb.type === "codeBlock")) return undefined;
  const fixedIds = (loc: BlockLocation) => loc.chain.filter((b) => FIXED_STRUCTURE.has(b.type)).map((b) => b.id).join("|");
  if (fixedIds(start) !== fixedIds(end)) return undefined;
  let j = end.chain.length - 1;
  while (j > depth) {
    const list = end.lists[j]!;
    if (list.indexOf(end.chain[j]!) < list.length - 1) break; // later siblings keep the parent alive
    if (!REMOVABLE_CONTAINERS.has(end.chain[j - 1]!.type)) return undefined;
    j--;
  }
  return j;
}

function appendSuffixOps(from: BlockNode, offsetInFrom: number, into: string, intoOffset: number): Operation[] {
  const ops: Operation[] = [];
  let offset = intoOffset;
  let pos = 0;
  for (const node of (from.content ?? []) as Inline[]) {
    if (isTextInline(node)) {
      const end = pos + node.text.length;
      if (end > offsetInFrom) {
        const text = node.text.slice(Math.max(0, offsetInFrom - pos));
        const marks = node.marks && node.marks.length > 0 ? cloneJson([...node.marks] as Mark[]) : undefined;
        ops.push({ type: "insert_text", at: { blockId: into, offset }, text, ...(marks ? { marks } : {}) });
        offset += text.length;
      }
      pos = end;
    } else {
      if (pos >= offsetInFrom) {
        ops.push({ type: "insert_inline", at: { blockId: into, offset }, node: cloneJson(node) });
        offset += 1;
      }
      pos += 1;
    }
  }
  return ops;
}

/** Builds the operations that replace the current multi-block selection, or undefined if unsupported. */
export function planCrossBlockEdit(state: EditorState, options: CrossBlockOptions): CrossBlockPlan | undefined {
  const sel = state.selection;
  if (!sel || sel.anchor.blockId === sel.head.blockId) return undefined;
  const la = locateBlock(state, sel.anchor.blockId);
  const lh = locateBlock(state, sel.head.blockId);
  if (!la || !lh || la.sectionIndex !== lh.sectionIndex || la.slot !== lh.slot) return undefined;
  if (!isTextBlock(la.chain[la.chain.length - 1]!) || !isTextBlock(lh.chain[lh.chain.length - 1]!)) return undefined;

  // First level at which the two ancestor chains differ. Text blocks are leaves, so neither
  // chain can be a prefix of the other.
  let depth = 0;
  while (depth < la.chain.length && depth < lh.chain.length && la.chain[depth]!.id === lh.chain[depth]!.id) depth++;
  if (depth >= la.chain.length || depth >= lh.chain.length) return undefined;

  const shared = la.lists[depth]!;
  const forward = shared.indexOf(la.chain[depth]!) < shared.indexOf(lh.chain[depth]!);
  const start = forward ? la : lh;
  const end = forward ? lh : la;
  const startPos = forward ? sel.anchor : sel.head;
  const endPos = forward ? sel.head : sel.anchor;
  const startBlock = start.chain[start.chain.length - 1]!;
  const endBlock = end.chain[end.chain.length - 1]!;
  const from = startPos.offset;
  const to = endPos.offset;
  const startLen = textLength(startBlock);
  const endLen = textLength(endBlock);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > startLen || to < 0 || to > endLen) return undefined;

  // Blocks that lie completely inside the selection, in document order.
  const inside: BlockNode[] = [];
  for (let k = start.chain.length - 1; k > depth; k--) {
    const list = start.lists[k]!;
    inside.push(...list.slice(list.indexOf(start.chain[k]!) + 1));
  }
  inside.push(...shared.slice(shared.indexOf(start.chain[depth]!) + 1, shared.indexOf(end.chain[depth]!)));
  for (let k = depth + 1; k < end.chain.length; k++) {
    const list = end.lists[k]!;
    inside.push(...list.slice(0, list.indexOf(end.chain[k]!)));
  }

  const ops: Operation[] = [];
  if (from < startLen) ops.push({ type: "delete_text", blockId: startBlock.id, from, to: startLen });
  if (to > 0) ops.push({ type: "delete_text", blockId: endBlock.id, from: 0, to });
  for (const block of inside) ops.push(...disposeOps(block, options.ids));

  const text = options.insertText ?? "";
  if (text) ops.push({ type: "insert_text", at: { blockId: startBlock.id, offset: from }, text });
  const caret: Position = { blockId: startBlock.id, offset: from + text.length };

  const target = mergeTarget(start, end, depth);
  if (target === undefined) return { ops, caret, joined: false };

  const adjacent = start.chain.length === depth + 1 && end.chain.length === depth + 1;
  if (adjacent) {
    ops.push({ type: "join_blocks", firstId: startBlock.id, secondId: endBlock.id });
  } else {
    ops.push(...appendSuffixOps(endBlock, to, startBlock.id, caret.offset));
    ops.push({ type: "remove_block", id: end.chain[target]!.id });
  }
  return { ops, caret, joined: true };
}

/** Side-effect free check used by `canRun`; never allocates real ids. */
export function canEditAcrossBlocks(state: EditorState): boolean {
  return planCrossBlockEdit(state, { ids: () => "probe" }) !== undefined;
}
