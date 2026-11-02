import type { Attrs, BlockNode, CommandSpec, EditorState, Transaction } from "@convetlib/core";
import { locateBlock } from "./structure";

export interface ImageMoveArgs {
  imageId: string;
  direction: "top" | "up" | "down" | "bottom" | "index";
  targetIndex?: number;
}
export interface ImageMoveToArgs {
  imageId: string;
  /** Block that the image is placed next to. It may live in another section (same slot, flow sections only). */
  targetId: string;
  placement: "before" | "after";
}
export interface ImageResizeArgs {
  imageId: string;
  /** Required unless `lockAspect` is true or the image already has a width. */
  width?: number;
  height?: number;
  /** Keeps the aspect ratio: the provided side drives the other one. Persisted as the `lockAspect` attribute. */
  lockAspect?: boolean;
  /** Ratio (width / height) used when the image has no usable width/height yet, e.g. the natural ratio. */
  aspectRatio?: number;
}
export const IMAGE_MIN_SIZE = 16;
export const IMAGE_MAX_WIDTH = 1600;
export const IMAGE_MAX_HEIGHT = 2200;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
/** Scales (w, h) uniformly so both sides fit [MIN, MAX]; when the limits conflict the maximum wins. */
function fitKeepingRatio(w: number, h: number): { width: number; height: number } {
  const maxScale = Math.min(IMAGE_MAX_WIDTH / w, IMAGE_MAX_HEIGHT / h);
  const minScale = IMAGE_MIN_SIZE / Math.min(w, h);
  const scale = Math.min(maxScale, Math.max(Math.min(1, maxScale), minScale));
  return { width: Math.round(w * scale * 100) / 100, height: Math.round(h * scale * 100) / 100 };
}
/** Containers that may receive an image next to one of their children (tables, rows and lists have strict structure). */
const IMAGE_CONTAINERS = new Set(["blockquote", "tableCell", "cell", "listItem"]);
function imageNode(state: EditorState, id: string): BlockNode | undefined {
  const location = locateBlock(state, id);
  const node = location?.chain[location.chain.length - 1];
  return node?.type === "image" ? node : undefined;
}
function imageList(state: EditorState, id: string) {
  const location = locateBlock(state, id);
  if (!location) return undefined;
  const list = location.lists[location.lists.length - 1];
  const node = location.chain[location.chain.length - 1];
  if (!list || !node || node.type !== "image") return undefined;
  const index = list.findIndex(item => item.id === id);
  if (index < 0) return undefined;
  const parent = location.chain.length > 1
    ? { kind: "node" as const, id: location.chain[location.chain.length - 2]!.id }
    : { kind: "section" as const, id: state.document.sections[location.sectionIndex]!.id, slot: location.slot };
  return { list, index, node, parent };
}
function planMoveTo(state: EditorState, args: ImageMoveToArgs) {
  if (args.imageId === args.targetId || (args.placement !== "before" && args.placement !== "after")) return undefined;
  const source = imageList(state, args.imageId);
  const sourceLocation = locateBlock(state, args.imageId);
  const target = locateBlock(state, args.targetId);
  if (!source || !sourceLocation || !target || sourceLocation.slot !== target.slot) return undefined;
  const sections = state.document.sections;
  if (sections[sourceLocation.sectionIndex]?.kind === "canvas" || sections[target.sectionIndex]?.kind === "canvas") return undefined;
  const targetList = target.lists[target.lists.length - 1];
  if (!targetList) return undefined;
  const targetIndex = targetList.findIndex(item => item.id === args.targetId);
  if (targetIndex < 0) return undefined;
  const parentNode = target.chain.length > 1 ? target.chain[target.chain.length - 2]! : undefined;
  if (parentNode && !IMAGE_CONTAINERS.has(parentNode.type)) return undefined;
  let index = targetIndex + (args.placement === "after" ? 1 : 0);
  const sameList = targetList === source.list;
  if (sameList && source.index < index) index -= 1; // the image is removed before it is inserted
  const parent = parentNode
    ? { kind: "node" as const, id: parentNode.id }
    : { kind: "section" as const, id: sections[target.sectionIndex]!.id, slot: target.slot };
  return { node: source.node, parent, index, noop: sameList && index === source.index };
}
function tx(state: EditorState, ops: Transaction["ops"], origin: string): { ok: true; transaction: Transaction } {
  return { ok: true, transaction: { id: `image-${state.version}-${origin}`, baseVersion: state.version, ops, meta: { origin: `command:${origin}`, timestamp: new Date().toISOString() } } };
}

/** Framework-neutral image commands; all changes are persisted as model transactions. */
export function createImageCommands(): CommandSpec[] {
  const move: CommandSpec<ImageMoveArgs> = {
    id: "image.move",
    title: "Move image",
    canRun: ({ state }, args) => !!args?.imageId && !!imageList(state, args.imageId),
    run: ({ state }, args) => {
      if (!args?.imageId) return { ok: false, reason: "image.move requires imageId" };
      const found = imageList(state, args.imageId);
      if (!found) return { ok: false, reason: "The image node was not found" };
      const { list, index, node, parent } = found;
      let target = args.direction === "top" ? 0
        : args.direction === "bottom" ? list.length - 1
        : args.direction === "up" ? Math.max(0, index - 1)
        : args.direction === "down" ? Math.min(list.length - 1, index + 1)
        : Number(args.targetIndex);
      if (!Number.isInteger(target)) return { ok: false, reason: "A valid targetIndex is required" };
      target = Math.max(0, Math.min(list.length - 1, target));
      if (target === index) return { ok: true };
      const insertAt = target;
      const attrs = { ...(node.attrs ?? {}) };
      delete attrs.positionX;
      delete attrs.positionY;
      const moved: BlockNode = { ...node, attrs };
      return tx(state, [
        { type: "remove_block", id: node.id },
        { type: "insert_block", parent, index: insertAt, node: moved },
      ], "image.move");
    },
  };
  const resize: CommandSpec<ImageResizeArgs> = {
    id: "image.resize",
    title: "Resize image",
    canRun: ({ state }, args) => !!args?.imageId && !!imageNode(state, args.imageId),
    run: ({ state }, args) => {
      if (!args?.imageId) return { ok: false, reason: "image.resize requires imageId" };
      const node = imageNode(state, args.imageId);
      if (!node) return { ok: false, reason: "The image node was not found" };
      for (const value of [args.width, args.height]) {
        if (value !== undefined && !positive(value)) return { ok: false, reason: "Image dimensions must be finite positive numbers" };
      }
      if (args.aspectRatio !== undefined && !positive(args.aspectRatio)) return { ok: false, reason: "aspectRatio must be a finite positive number" };
      const current = node.attrs ?? {};
      const lock = args.lockAspect ?? (current.lockAspect === true);
      let width = args.width;
      let height = args.height;
      if (lock) {
        // The ratio comes from the stored size, the caller-provided ratio, or - when both sides are given - from those sides.
        const ratio = args.aspectRatio ?? (positive(current.width) && positive(current.height) ? current.width / current.height : undefined);
        if (width !== undefined && height !== undefined && args.aspectRatio === undefined && ratio === undefined) {
          /* both sides given and nothing stored: they define the ratio */
        } else if (width !== undefined && height === undefined) {
          if (ratio === undefined) return { ok: false, reason: "Aspect ratio is unknown; pass aspectRatio or both sides" };
          height = width / ratio;
        } else if (height !== undefined && width === undefined) {
          if (ratio === undefined) return { ok: false, reason: "Aspect ratio is unknown; pass aspectRatio or both sides" };
          width = height * ratio;
        } else if (width !== undefined && height !== undefined && ratio !== undefined) {
          height = width / ratio; // width drives when a locked resize receives both sides
        } else return { ok: false, reason: "image.resize requires width and/or height" };
        const fitted = fitKeepingRatio(width!, height!);
        width = fitted.width;
        height = fitted.height;
      } else {
        width ??= positive(current.width) ? current.width : undefined;
        height ??= positive(current.height) ? current.height : undefined;
        if (width === undefined || height === undefined) return { ok: false, reason: "image.resize requires width and height" };
        width = Math.max(IMAGE_MIN_SIZE, Math.min(IMAGE_MAX_WIDTH, width));
        height = Math.max(IMAGE_MIN_SIZE, Math.min(IMAGE_MAX_HEIGHT, height));
      }
      const set: Attrs = { width, height };
      if (args.lockAspect !== undefined) set.lockAspect = args.lockAspect;
      return tx(state, [{ type: "set_attrs", id: node.id, set }], "image.resize");
    },
  };
  const moveTo: CommandSpec<ImageMoveToArgs> = {
    id: "image.moveTo",
    title: "Move image next to a block",
    canRun: ({ state }, args) => !!args?.imageId && !!args?.targetId && !!planMoveTo(state, args),
    run: ({ state }, args) => {
      if (!args?.imageId || !args?.targetId || (args.placement !== "before" && args.placement !== "after"))
        return { ok: false, reason: "image.moveTo requires imageId, targetId and placement" };
      const plan = planMoveTo(state, args);
      if (!plan) return { ok: false, reason: "The image cannot be placed there (missing block, canvas section, other slot or restricted container)" };
      if (plan.noop) return { ok: true };
      return tx(state, [
        { type: "remove_block", id: plan.node.id },
        { type: "insert_block", parent: plan.parent, index: plan.index, node: plan.node },
      ], "image.moveTo");
    },
  };
  return [move, moveTo, resize];
}
