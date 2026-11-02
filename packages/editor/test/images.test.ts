import { describe, expect, it } from "vitest";
import { createDocument, createEditor, createNodeFactory, createSequentialIdGenerator } from "@convetlib/core";
import { registerEditingCommands } from "../src/index";

describe("image commands", () => {
  it("moves an image to the top and bottom of its section without changing its id", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const image = { type: "image", id: ids(), attrs: { src: "data:image/png;base64,AA==", width: 120, height: 80 } };
    const before = f.paragraph("before");
    const after = f.paragraph("after");
    const editor = await createEditor({ document: createDocument({ ids, content: [before, image, after] }), ids });
    registerEditingCommands(editor, { ids });
    expect(editor.commands.execute("image.move", { imageId: image.id, direction: "top" }).ok).toBe(true);
    expect(editor.state.document.sections[0]!.content.map(node => node.id)).toEqual([image.id, before.id, after.id]);
    expect(editor.commands.execute("image.move", { imageId: image.id, direction: "bottom" }).ok).toBe(true);
    expect(editor.state.document.sections[0]!.content.map(node => node.id)).toEqual([before.id, after.id, image.id]);
    await editor.destroy();
  });

  it("resizes an image through persisted model attributes and rejects invalid dimensions", async () => {
    const ids = createSequentialIdGenerator();
    const image = { type: "image", id: ids(), attrs: { src: "data:image/png;base64,AA==", width: 120, height: 80 } };
    const editor = await createEditor({ document: createDocument({ ids, content: [image] }), ids });
    registerEditingCommands(editor, { ids });
    expect(editor.commands.execute("image.resize", { imageId: image.id, width: 240, height: 160 }).ok).toBe(true);
    expect(editor.state.document.sections[0]!.content[0]!.attrs).toMatchObject({ width: 240, height: 160 });
    expect(editor.commands.execute("image.resize", { imageId: image.id, width: Number.NaN, height: 160 }).ok).toBe(false);
    await editor.destroy();
  });
});

async function setup(extra: Record<string, unknown> = {}) {
  const ids = createSequentialIdGenerator();
  const f = createNodeFactory(ids);
  const a = f.paragraph("a");
  const b = f.paragraph("b");
  const image = { type: "image", id: ids(), attrs: { src: "data:image/png;base64,AA==", alt: "logo", align: "center", width: 120, height: 80, ...extra } };
  const c = f.paragraph("c");
  const editor = await createEditor({ document: createDocument({ ids, content: [a, b, image, c] }), ids });
  registerEditingCommands(editor, { ids });
  const order = () => editor.state.document.sections[0]!.content.map(node => node.id);
  return { ids, f, editor, a, b, c, image, order };
}

describe("image.move directions", () => {
  it("moves up, down and by index, clamps at the ends and keeps the id and other attributes", async () => {
    const { editor, a, b, c, image, order } = await setup();
    expect(editor.commands.execute("image.move", { imageId: image.id, direction: "up" }).ok).toBe(true);
    expect(order()).toEqual([a.id, image.id, b.id, c.id]);
    expect(editor.commands.execute("image.move", { imageId: image.id, direction: "down" }).ok).toBe(true);
    expect(order()).toEqual([a.id, b.id, image.id, c.id]);
    expect(editor.commands.execute("image.move", { imageId: image.id, direction: "index", targetIndex: 1 }).ok).toBe(true);
    expect(order()).toEqual([a.id, image.id, b.id, c.id]);
    expect(editor.commands.execute("image.move", { imageId: image.id, direction: "index", targetIndex: 99 }).ok).toBe(true);
    expect(order()).toEqual([a.id, b.id, c.id, image.id]);
    expect(editor.commands.execute("image.move", { imageId: image.id, direction: "index" }).ok).toBe(false);
    const moved = editor.state.document.sections[0]!.content.at(-1)!;
    expect(moved.attrs).toMatchObject({ src: "data:image/png;base64,AA==", alt: "logo", align: "center", width: 120, height: 80 });
    await editor.destroy();
  });

  it("clears free positionX/positionY (flow move) but keeps everything else, and undo restores them", async () => {
    const { editor, a, b, c, image, order } = await setup({ positionX: 40, positionY: 60 });
    expect(editor.commands.execute("image.move", { imageId: image.id, direction: "top" }).ok).toBe(true);
    const node = editor.state.document.sections[0]!.content[0]!;
    expect(node.attrs).not.toHaveProperty("positionX");
    expect(node.attrs).toMatchObject({ alt: "logo", width: 120 });
    expect(editor.history.undo()).toBe(true);
    expect(order()).toEqual([a.id, b.id, image.id, c.id]);
    expect(editor.state.document.sections[0]!.content[2]!.attrs).toMatchObject({ positionX: 40, positionY: 60 });
    expect(editor.history.redo()).toBe(true);
    expect(order()).toEqual([image.id, a.id, b.id, c.id]);
    await editor.destroy();
  });
});

describe("image.moveTo", () => {
  it("places the image before or after another block and adjusts the index for same-list moves", async () => {
    const { editor, a, b, c, image, order } = await setup();
    expect(editor.commands.execute("image.moveTo", { imageId: image.id, targetId: a.id, placement: "before" }).ok).toBe(true);
    expect(order()).toEqual([image.id, a.id, b.id, c.id]);
    expect(editor.commands.execute("image.moveTo", { imageId: image.id, targetId: c.id, placement: "after" }).ok).toBe(true);
    expect(order()).toEqual([a.id, b.id, c.id, image.id]);
    expect(editor.commands.execute("image.moveTo", { imageId: image.id, targetId: b.id, placement: "after" }).ok).toBe(true);
    expect(order()).toEqual([a.id, b.id, image.id, c.id]);
    expect(editor.commands.execute("image.moveTo", { imageId: image.id, targetId: c.id, placement: "before" }).ok).toBe(true); // no-op
    expect(order()).toEqual([a.id, b.id, image.id, c.id]);
    await editor.destroy();
  });

  it("rejects missing targets, self targets and bad placement", async () => {
    const { editor, a, image } = await setup();
    expect(editor.commands.execute("image.moveTo", { imageId: image.id, targetId: "nope", placement: "after" }).ok).toBe(false);
    expect(editor.commands.execute("image.moveTo", { imageId: image.id, targetId: image.id, placement: "after" }).ok).toBe(false);
    expect(editor.commands.execute("image.moveTo", { imageId: image.id, targetId: a.id, placement: "middle" as never }).ok).toBe(false);
    await editor.destroy();
  });

  it("moves an image to another section of the same slot", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const image = { type: "image", id: ids(), attrs: { src: "data:image/png;base64,AA==", width: 50, height: 50 } };
    const p1 = f.paragraph("one");
    const p2 = f.paragraph("two");
    const base = createDocument({ ids, content: [p1, image] });
    const second = { ...base.sections[0]!, id: ids(), content: [p2] };
    const document = { ...base, sections: [base.sections[0]!, second] } as typeof base;
    const editor = await createEditor({ document, ids });
    registerEditingCommands(editor, { ids });
    expect(editor.commands.execute("image.moveTo", { imageId: image.id, targetId: p2.id, placement: "before" }).ok).toBe(true);
    expect(editor.state.document.sections[0]!.content.map(n => n.id)).toEqual([p1.id]);
    expect(editor.state.document.sections[1]!.content.map(n => n.id)).toEqual([image.id, p2.id]);
    await editor.destroy();
  });
});

describe("image.resize with aspect ratio", () => {
  it("keeps the ratio when locked, from either side, and persists lockAspect", async () => {
    const { editor, image } = await setup();
    expect(editor.commands.execute("image.resize", { imageId: image.id, width: 240, lockAspect: true }).ok).toBe(true);
    expect(editor.state.document.sections[0]!.content[2]!.attrs).toMatchObject({ width: 240, height: 160, lockAspect: true });
    // lockAspect is now stored on the image, so a later resize stays locked without repeating the flag
    expect(editor.commands.execute("image.resize", { imageId: image.id, height: 80 }).ok).toBe(true);
    expect(editor.state.document.sections[0]!.content[2]!.attrs).toMatchObject({ width: 120, height: 80 });
    await editor.destroy();
  });

  it("clamps to the limits without distorting a locked ratio and never writes unsafe numbers", async () => {
    const { editor, image } = await setup();
    expect(editor.commands.execute("image.resize", { imageId: image.id, width: 100000, lockAspect: true }).ok).toBe(true);
    const big = editor.state.document.sections[0]!.content[2]!.attrs as { width: number; height: number };
    expect(big.width).toBeLessThanOrEqual(1600);
    expect(big.width / big.height).toBeCloseTo(1.5, 1);
    expect(editor.commands.execute("image.resize", { imageId: image.id, width: 1, lockAspect: true }).ok).toBe(true);
    const small = editor.state.document.sections[0]!.content[2]!.attrs as { width: number; height: number };
    expect(small.height).toBeGreaterThanOrEqual(16);
    expect(small.width / small.height).toBeCloseTo(1.5, 1);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(editor.commands.execute("image.resize", { imageId: image.id, width: bad, height: 50 }).ok).toBe(false);
      expect(editor.commands.execute("image.resize", { imageId: image.id, width: 50, height: bad, lockAspect: false }).ok).toBe(false);
    }
    await editor.destroy();
  });

  it("uses the provided aspectRatio when the image has no stored size", async () => {
    const ids = createSequentialIdGenerator();
    const image = { type: "image", id: ids(), attrs: { src: "data:image/png;base64,AA==" } };
    const editor = await createEditor({ document: createDocument({ ids, content: [image] }), ids });
    registerEditingCommands(editor, { ids });
    expect(editor.commands.execute("image.resize", { imageId: image.id, width: 200, lockAspect: true }).ok).toBe(false);
    expect(editor.commands.execute("image.resize", { imageId: image.id, width: 200, lockAspect: true, aspectRatio: 2 }).ok).toBe(true);
    expect(editor.state.document.sections[0]!.content[0]!.attrs).toMatchObject({ width: 200, height: 100 });
    await editor.destroy();
  });
});
