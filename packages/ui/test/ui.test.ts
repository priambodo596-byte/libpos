import { describe, expect, it } from "vitest";
import type { BlockNode } from "@convetlib/core";
import {
  createDocument,
  createEditor,
  createNodeFactory,
  createSequentialIdGenerator,
} from "@convetlib/core";
import { registerEditingCommands, setSelection } from "@convetlib/editor";
import { DEFAULT_TOOLBAR, getToolbarState } from "../src/index";

describe("framework-neutral toolbar model", () => {
  it("reflects command availability and current selection", async () => {
    const ids = createSequentialIdGenerator();
    const factory = createNodeFactory(ids);
    const editor = await createEditor({
      document: createDocument({ ids, content: [factory.paragraph("hello")] }),
      ids,
    });
    registerEditingCommands(editor, { ids });

    const block = editor.state.document.sections[0]!.content[0]!;
    setSelection(editor, {
      anchor: { blockId: block.id, offset: 1 },
      head: { blockId: block.id, offset: 4 },
    }, { ids });

    const toolbar = getToolbarState(editor);
    expect(toolbar.find(item => item.id === "bold")?.enabled).toBe(true);
    expect(toolbar.find(item => item.id === "heading-1")?.enabled).toBe(true);
    expect(DEFAULT_TOOLBAR.length).toBeGreaterThan(5);
    await editor.destroy();
  });

  it("finds selected text blocks nested inside table cells", async () => {
    const ids = createSequentialIdGenerator();
    const factory = createNodeFactory(ids);
    const table = factory.table([["cell one", "cell two"]]);
    const document = createDocument({ ids, content: [table] });
    const editor = await createEditor({ document, ids });
    registerEditingCommands(editor, { ids });

    const row = table.content![0] as BlockNode;
    const cell = row.content![0] as BlockNode;
    const paragraph = cell.content![0] as BlockNode;
    setSelection(editor, {
      anchor: { blockId: paragraph.id, offset: 0 },
      head: { blockId: paragraph.id, offset: 4 },
    }, { ids });

    const toolbar = getToolbarState(editor);
    expect(toolbar.find(item => item.id === "bold")?.enabled).toBe(true);
    expect(toolbar.find(item => item.id === "paragraph")?.active).toBe(true);
    await editor.destroy();
  });

  it("finds selected blocks in section headers and footers", async () => {
    const ids = createSequentialIdGenerator();
    const factory = createNodeFactory(ids);
    const body = factory.paragraph("body");
    const header = factory.paragraph("header");
    const footer = factory.heading(1, "footer");
    const document = createDocument({ ids, content: [body] });
    document.sections[0]!.header = [header];
    document.sections[0]!.footer = [footer];

    const editor = await createEditor({ document, ids });
    registerEditingCommands(editor, { ids });

    setSelection(editor, {
      anchor: { blockId: header.id, offset: 0 },
      head: { blockId: header.id, offset: 3 },
    }, { ids });
    let toolbar = getToolbarState(editor);
    expect(toolbar.find(item => item.id === "paragraph")?.active).toBe(true);

    setSelection(editor, {
      anchor: { blockId: footer.id, offset: 0 },
      head: { blockId: footer.id, offset: 3 },
    }, { ids });
    toolbar = getToolbarState(editor);
    expect(toolbar.find(item => item.id === "heading-1")?.active).toBe(true);
    await editor.destroy();
  });

  it("does not mark a formatting command active when selection has no matching mark", async () => {
    const ids = createSequentialIdGenerator();
    const factory = createNodeFactory(ids);
    const paragraph = factory.paragraph("plain text");
    const editor = await createEditor({
      document: createDocument({ ids, content: [paragraph] }),
      ids,
    });
    registerEditingCommands(editor, { ids });

    setSelection(editor, {
      anchor: { blockId: paragraph.id, offset: 0 },
      head: { blockId: paragraph.id, offset: 5 },
    }, { ids });

    expect(getToolbarState(editor).find(item => item.id === "bold")?.active).toBe(false);
    await editor.destroy();
  });
});
