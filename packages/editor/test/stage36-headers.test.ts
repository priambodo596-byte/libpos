import { describe, expect, it } from "vitest";
import { createDocument, createEditor } from "@convetlib/core";

const paragraph = (id: string, text: string) => ({ id, type: "paragraph", content: [{ type: "text", text }] });

describe("first/even page header/footer editor integration", () => {
  it("inserts into each variant slot and supports undo/redo", async () => {
    let seq = 0; const ids = () => `variant-${++seq}`;
    const doc = createDocument({ ids, content: [paragraph(ids(), "body")] });
    const section = doc.sections[0]!;
    section.firstPageHeader = [paragraph(ids(), "first head")];
    section.firstPageFooter = [];
    section.evenPageHeader = [paragraph(ids(), "even head")];
    section.evenPageFooter = [paragraph(ids(), "even foot")];
    const editor = await createEditor({ document: doc, ids });
    for (const slot of ["firstPageHeader", "firstPageFooter", "evenPageHeader", "evenPageFooter"] as const) {
      const node = paragraph(ids(), "created variant");
      const beforeLength = editor.state.document.sections[0]![slot]?.length ?? 0;
      const result = editor.dispatch({ id: ids(), baseVersion: editor.state.version, ops: [{ type: "insert_block", parent: { kind: "section", id: section.id, slot }, index: beforeLength, node }], meta: { origin: "stage36", timestamp: "2026-10-28T00:00:00.000Z" } });
      expect(result.ok, `slot ${slot} should accept insert`).toBe(true);
      expect(editor.state.document.sections[0]![slot]).toHaveLength(beforeLength + 1);
      expect(editor.history.undo()).toBe(true);
      expect(editor.history.redo()).toBe(true);
    }
    await editor.destroy();
  });

  it("creates an undefined variant region and rejects selections spanning body and variant slots", async () => {
    let seq = 0; const ids = () => `variant-edge-${++seq}`;
    const doc = createDocument({ ids, content: [paragraph(ids(), "body")] });
    const body = doc.sections[0]!.content[0]!;
    const editor = await createEditor({ document: doc, ids });
    const inserted = paragraph(ids(), "first header");
    const add = editor.dispatch({ id: ids(), baseVersion: editor.state.version, ops: [{ type: "insert_block", parent: { kind: "section", id: doc.sections[0]!.id, slot: "firstPageHeader" }, index: 0, node: inserted }], meta: { origin: "stage36-edge", timestamp: "2026-10-28T00:00:00.000Z" } });
    expect(add.ok).toBe(true);
    expect(editor.state.document.sections[0]!.firstPageHeader).toHaveLength(1);
    const selection = editor.dispatch({ id: ids(), baseVersion: editor.state.version, ops: [], selection: { anchor: { blockId: body.id, offset: 0 }, head: { blockId: inserted.id, offset: 1 } }, meta: { origin: "stage36-edge", timestamp: "2026-10-28T00:00:01.000Z" } });
    expect(selection.ok).toBe(true);
    const command = editor.commands.execute("text.insert", { text: "unsafe" });
    expect(command.ok).toBe(false);
    await editor.destroy();
  });

  it("finds variant block IDs for text operations", async () => {
    let seq = 0; const ids = () => `variant-lookup-${++seq}`;
    const doc = createDocument({ ids, content: [paragraph(ids(), "body")] });
    doc.sections[0]!.evenPageFooter = [paragraph(ids(), "footer")];
    const editor = await createEditor({ document: doc, ids });
    const variant = editor.state.document.sections[0]!.evenPageFooter![0]!;
    const result = editor.dispatch({ id: ids(), baseVersion: editor.state.version, ops: [{ type: "insert_text", at: { blockId: variant.id, offset: 6 }, text: "!" }], meta: { origin: "stage36", timestamp: "2026-10-28T00:00:00.000Z" } });
    expect(result.ok).toBe(true);
    expect(editor.state.document.sections[0]!.evenPageFooter![0]!.content?.map(n => "text" in n && typeof n.text === "string" ? n.text : "").join("")).toBe("footer!");
    await editor.destroy();
  });
});
