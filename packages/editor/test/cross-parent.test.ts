import { describe, expect, it } from "vitest";
import {
  createDocument,
  createEditor,
  createNodeFactory,
  createSection,
  createSequentialIdGenerator,
  type BlockNode,
  type Editor,
  type IdGenerator,
  type Inline,
} from "@convetlib/core";
import { createEditingCommands, getTextBlocks, handleKeyboardShortcut, registerEditingCommands, setSelection } from "../src/index";

const isBlock = (n: BlockNode | Inline): n is BlockNode => typeof (n as BlockNode).id === "string";
const kid = (node: BlockNode, i: number): BlockNode => node.content![i] as BlockNode;

/** Compact structural description, e.g. `bulletList(listItem(paragraph:alma))`. */
function shape(node: BlockNode): string {
  const kids = node.content ?? [];
  if (kids.some(isBlock)) return `${node.type}(${(kids as BlockNode[]).map(shape).join(",")})`;
  const text = (kids as Inline[]).map((k) => (k.type === "text" ? (k as { text: string }).text : "\uFFFC")).join("");
  return `${node.type}:${text}`;
}
/** Document JSON without `meta.updatedAt`, which the engine refreshes on every dispatch (undo included). */
const stable = (ed: Editor) => JSON.stringify({ ...ed.state.document, meta: { ...ed.state.document.meta, updatedAt: "" } });
const shapes = (ed: Editor, section = 0) => ed.state.document.sections[section]!.content.map(shape);

const at = (block: BlockNode, offset: number) => ({ blockId: block.id, offset });

async function open(build: (f: ReturnType<typeof createNodeFactory>) => BlockNode[], ids: IdGenerator = createSequentialIdGenerator()) {
  const f = createNodeFactory(ids);
  const content = build(f);
  const ed = await createEditor({ document: createDocument({ ids, content }), ids });
  registerEditingCommands(ed, { ids });
  return { ed, ids, content, f };
}

function select(ed: Editor, ids: IdGenerator, anchor: ReturnType<typeof at>, head: ReturnType<typeof at>) {
  const r = setSelection(ed, { anchor, head }, { ids });
  expect(r.ok).toBe(true);
}

describe("cross-parent selection: lists", () => {
  const build = (f: ReturnType<typeof createNodeFactory>) => [f.bulletList(["alpha", "beta", "gamma"])];
  const paras = (list: BlockNode) => [0, 1, 2].map((i) => kid(kid(list, i), 0));

  it("deletes across list items, removing the emptied items", async () => {
    const { ed, ids, content } = await open(build);
    const [a, , c] = paras(content[0]!);
    select(ed, ids, at(a!, 2), at(c!, 3));
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(shapes(ed)).toEqual(["bulletList(listItem(paragraph:alma))"]);
    expect(ed.state.selection?.head).toEqual(at(a!, 2));
    await ed.destroy();
  });

  it("handles a reversed selection (head before anchor)", async () => {
    const { ed, ids, content } = await open(build);
    const [a, , c] = paras(content[0]!);
    select(ed, ids, at(c!, 3), at(a!, 2));
    expect(ed.commands.execute("text.deleteForward").ok).toBe(true);
    expect(shapes(ed)).toEqual(["bulletList(listItem(paragraph:alma))"]);
    await ed.destroy();
  });

  it("deletes with the Backspace key through the shortcut dispatcher", async () => {
    const { ed, ids, content } = await open(build);
    const [a, , c] = paras(content[0]!);
    select(ed, ids, at(a!, 2), at(c!, 3));
    expect(handleKeyboardShortcut(ed, { key: "Backspace" })).toMatchObject({ handled: true });
    expect(getTextBlocks(ed.state).map((b) => b.text)).toEqual(["alma"]);
    await ed.destroy();
  });

  it("replaces the selection with typed text", async () => {
    const { ed, ids, content } = await open(build);
    const [a, , c] = paras(content[0]!);
    select(ed, ids, at(a!, 2), at(c!, 3));
    expect(ed.commands.execute("text.insert", { text: "-" }).ok).toBe(true);
    expect(getTextBlocks(ed.state).map((b) => b.text)).toEqual(["al-ma"]);
    expect(ed.state.selection?.head).toEqual(at(a!, 3));
    await ed.destroy();
  });

  it("Enter replaces the selection and then splits at the caret", async () => {
    const { ed, ids, content } = await open(build);
    const [a, , c] = paras(content[0]!);
    select(ed, ids, at(a!, 2), at(c!, 3));
    expect(handleKeyboardShortcut(ed, { key: "Enter" })).toMatchObject({ handled: true });
    expect(shapes(ed)).toEqual(["bulletList(listItem(paragraph:al,paragraph:ma))"]);
    const blocks = getTextBlocks(ed.state);
    expect(ed.state.selection?.head).toEqual({ blockId: blocks[1]!.id, offset: 0 });
    await ed.destroy();
  });
  it("preserves intermediate sections while clearing their selected text blocks", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const first = f.paragraph("start"), middleA = f.heading(2, "middle"), middleB = f.paragraph("also middle"), last = f.paragraph("finish");
    const doc = createDocument({ ids, content: [first] });
    doc.sections.push(createSection([middleA, middleB], { ids }));
    doc.sections.push(createSection([last], { ids }));
    const ed = await createEditor({ document: doc, ids });
    registerEditingCommands(ed, { ids });
    select(ed, ids, at(first, 2), at(last, 2));
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(ed.state.document.sections).toHaveLength(3);
    expect(ed.state.document.sections[1]!.content).toHaveLength(1);
    expect(ed.state.document.sections[1]!.content[0]!.type).toBe("paragraph");
    expect((ed.state.document.sections[1]!.content[0]!.content ?? []).map((x) => "text" in x ? x.text : "").join("")).toBe("");
    await ed.destroy();
  });

});

describe("cross-parent selection: mixed nesting", () => {
  it("from a top-level paragraph into a list item removes the swallowed list", async () => {
    const { ed, ids, content } = await open((f) => [f.paragraph("intro"), f.bulletList(["one", "two"]), f.paragraph("outro")]);
    const two = kid(kid(content[1]!, 1), 0);
    select(ed, ids, at(content[0]!, 2), at(two, 1));
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(shapes(ed)).toEqual(["paragraph:inwo", "paragraph:outro"]);
    await ed.destroy();
  });

  it("typing over a top-level-to-list selection", async () => {
    const { ed, ids, content } = await open((f) => [f.paragraph("intro"), f.bulletList(["one", "two"]), f.paragraph("outro")]);
    const two = kid(kid(content[1]!, 1), 0);
    select(ed, ids, at(content[0]!, 2), at(two, 1));
    expect(ed.commands.execute("text.insert", { text: "X" }).ok).toBe(true);
    expect(shapes(ed)).toEqual(["paragraph:inXwo", "paragraph:outro"]);
    expect(ed.state.selection?.head).toEqual(at(content[0]!, 3));
    await ed.destroy();
  });

  it("from a list item to the paragraph after the list pulls the tail into the item", async () => {
    const { ed, ids, content } = await open((f) => [f.bulletList(["one", "two"]), f.paragraph("after")]);
    const one = kid(kid(content[0]!, 0), 0);
    select(ed, ids, at(one, 1), at(content[1]!, 2));
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(shapes(ed)).toEqual(["bulletList(listItem(paragraph:oter))"]);
    await ed.destroy();
  });

  it("handles a nested list inside the start item", async () => {
    const { ed, ids, content } = await open((f) => [f.bulletList([[f.paragraph("parent"), f.bulletList(["child1", "child2"])], "next"])]);
    const parent = kid(kid(content[0]!, 0), 0);
    const next = kid(kid(content[0]!, 1), 0);
    select(ed, ids, at(parent, 3), at(next, 1));
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(shapes(ed)).toEqual(["bulletList(listItem(paragraph:parext))"]);
    await ed.destroy();
  });

  it("works inside a blockquote and merges the following paragraph", async () => {
    const { ed, ids, content } = await open((f) => [f.block("blockquote", [f.paragraph("quote")]), f.paragraph("tail")]);
    select(ed, ids, at(kid(content[0]!, 0), 2), at(content[1]!, 1));
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(shapes(ed)).toEqual(["blockquote(paragraph:quail)"]);
    await ed.destroy();
  });

  it("removes a table that lies entirely inside the selection", async () => {
    const { ed, ids, content } = await open((f) => [f.paragraph("a"), f.table([["t"]]), f.paragraph("z")]);
    select(ed, ids, at(content[0]!, 0), at(content[2]!, 1));
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(shapes(ed)).toEqual(["paragraph:"]);
    await ed.destroy();
  });

  it("preserves inline marks of the merged tail", async () => {
    const { ed, ids, content } = await open((f) => [f.paragraph("ab"), f.bulletList([[f.paragraph([f.text("x"), f.text("yz", [{ type: "bold" }])])]])]);
    select(ed, ids, at(content[0]!, 2), at(kid(kid(content[1]!, 0), 0), 1));
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(shapes(ed)).toEqual(["paragraph:abyz"]);
    expect(ed.state.document.sections[0]!.content[0]!.content![1]).toMatchObject({ text: "yz", marks: [{ type: "bold" }] });
    await ed.destroy();
  });

  it("does not merge a paragraph into a code block (kinds differ)", async () => {
    const { ed, ids, content } = await open((f) => [f.paragraph("abc"), f.block("codeBlock", [f.text("code")])]);
    select(ed, ids, at(content[0]!, 1), at(content[1]!, 2));
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(shapes(ed)).toEqual(["paragraph:a", "codeBlock:de"]);
    await ed.destroy();
  });
});

describe("cross-parent selection: tables keep their grid", () => {
  const grid = (f: ReturnType<typeof createNodeFactory>) => [f.table([["a1", "b1"], ["a2", "b2"]])];
  const cellPara = (table: BlockNode, row: number, col: number) => kid(kid(kid(table, row), col), 0);

  it("across cells empties the covered cells and never merges or removes cells", async () => {
    const { ed, ids, content } = await open(grid);
    select(ed, ids, at(cellPara(content[0]!, 0, 0), 1), at(cellPara(content[0]!, 1, 1), 1));
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(shapes(ed)).toEqual([
      "table(tableRow(tableCell(paragraph:a),tableCell(paragraph:)),tableRow(tableCell(paragraph:),tableCell(paragraph:2)))",
    ]);
    await ed.destroy();
  });

  it("empties whole rows that lie between the endpoints", async () => {
    const { ed, ids, content } = await open((f) => [f.table([["r1"], ["r2"], ["r3"]])]);
    select(ed, ids, at(cellPara(content[0]!, 0, 0), 1), at(cellPara(content[0]!, 2, 0), 1));
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(shapes(ed)).toEqual([
      "table(tableRow(tableCell(paragraph:r)),tableRow(tableCell(paragraph:)),tableRow(tableCell(paragraph:3)))",
    ]);
    await ed.destroy();
  });

  it("from a cell to a paragraph after the table keeps the table and the paragraph separate", async () => {
    const { ed, ids, content } = await open((f) => [f.table([["x", "y"]]), f.paragraph("after")]);
    select(ed, ids, at(cellPara(content[0]!, 0, 0), 0), at(content[1]!, 2));
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(shapes(ed)).toEqual(["table(tableRow(tableCell(paragraph:),tableCell(paragraph:)))", "paragraph:ter"]);
    await ed.destroy();
  });

  it("allocates ids only when it runs, never when only checking availability", async () => {
    let calls = 0;
    const base = createSequentialIdGenerator();
    const ids: IdGenerator = () => (calls++, base());
    const { ed, content } = await open(grid, ids);
    select(ed, ids, at(cellPara(content[0]!, 0, 0), 1), at(cellPara(content[0]!, 1, 1), 1));
    const before = calls;
    for (let i = 0; i < 3; i++) {
      expect(ed.commands.can("text.deleteBackward")).toBe(true);
      expect(ed.commands.can("text.insert", { text: "x" })).toBe(true);
      expect(ed.commands.can("block.split")).toBe(true);
    }
    expect(calls).toBe(before);
    await ed.destroy();
  });
});

describe("cross-parent selection: undo and limits", () => {
  it("undo restores the exact previous document after a structural deletion", async () => {
    const { ed, ids, content } = await open((f) => [f.paragraph("intro"), f.bulletList(["one", "two"]), f.table([["c"]]), f.paragraph("outro")]);
    const before = stable(ed);
    select(ed, ids, at(content[0]!, 2), at(content[3]!, 1));
    const selected = stable(ed);
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(shapes(ed)).toEqual(["paragraph:inutro"]);
    expect(ed.history.undo()).toBe(true);
    expect(stable(ed)).toBe(selected);
    expect(selected).toBe(before);
    await ed.destroy();
  });

  it("replaces a supported selection across top-level text blocks in separate sections", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const first = f.paragraph("one"), second = f.paragraph("two");
    const doc = createDocument({ ids, content: [first] });
    doc.sections.push(createSection([second], { ids }));
    const ed = await createEditor({ document: doc, ids });
    registerEditingCommands(ed, { ids });
    select(ed, ids, at(first, 1), at(second, 1));
    expect(ed.commands.can("text.insert", { text: "x" })).toBe(true);
    expect(ed.commands.execute("text.insert", { text: "x" }).ok).toBe(true);
    expect(shapes(ed)).toEqual(["paragraph:ox"]);
    expect(ed.state.document.sections[1]!.content.map((n) => `${n.type}:${(n.content ?? []).map((x) => "text" in x ? x.text : "").join("")}`)).toEqual(["paragraph:wo"]);
    await ed.destroy();
  });

  it("direct command run supports the same cross-section text replacement", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const first = f.paragraph("one"), second = f.paragraph("two");
    const doc = createDocument({ ids, content: [first] });
    doc.sections.push(createSection([second], { ids }));
    const ed = await createEditor({ document: doc, ids });
    select(ed, ids, at(first, 1), at(second, 1));
    const specs = createEditingCommands({ ids });
    const spec = specs.find((s) => s.id === "text.insert")!;
    const outcome = spec.run({ state: ed.state }, { text: "x" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.transaction?.ops).toEqual(expect.arrayContaining([expect.objectContaining({ type: "insert_text", text: "x" })]));
    await ed.destroy();
  });

  it("refuses a selection from a header into the body instead of editing elsewhere", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const head = f.paragraph("head"), body = f.paragraph("body");
    const doc = createDocument({ ids, content: [body] });
    doc.sections[0]!.header = [head];
    const ed = await createEditor({ document: doc, ids });
    registerEditingCommands(ed, { ids });
    select(ed, ids, at(head, 1), at(body, 1));
    const snapshot = stable(ed);
    expect(ed.commands.execute("text.insert", { text: "x" }).ok).toBe(false);
    expect(stable(ed)).toBe(snapshot);
    await ed.destroy();
  });

  it("refuses a selection whose endpoint is not a text block", async () => {
    const { ed, ids, content } = await open((f) => [f.paragraph("text"), f.image("a.png")]);
    select(ed, ids, at(content[0]!, 1), at(content[1]!, 0));
    const snapshot = stable(ed);
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(false);
    expect(stable(ed)).toBe(snapshot);
    await ed.destroy();
  });
});
