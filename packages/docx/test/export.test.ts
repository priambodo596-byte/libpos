import { describe, expect, it } from "vitest";
import { createDocument, createNodeFactory, createSequentialIdGenerator } from "@convetlib/core";
import { exportDocx, importDocx } from "../src/index";

describe("DOCX export adapter", () => {
  it("creates a non-empty OOXML DOCX package from paragraphs, headings, tables and page breaks", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const title = f.heading(1, "Document title");
    const paragraph = f.paragraph([
      f.text("Bold text", [{ type: "bold" }]),
      f.text(" and plain text"),
      f.placeholder("letter.number"),
    ]);
    const table = f.table([["Name", "Value"], ["Example", "42"]]);
    const doc = createDocument({
      ids,
      title: "Export test",
      content: [title, paragraph, table, f.pageBreak(), f.paragraph("Second page")],
    });

    const bytes = await exportDocx(doc);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
  });

  it("uses a readable image fallback when no image resolver is provided", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({ ids, content: [f.image("https://example.com/logo.png", { alt: "Company logo" })] });
    const bytes = await exportDocx(doc);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
  });

  it("imports exported DOCX paragraphs, headings, marks, tables, and page geometry", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({
      ids,
      title: "Import round trip",
      now: "2026-02-03T04:05:06.000Z",
      content: [
        f.heading(2, "Heading from Word"),
        f.paragraph([f.text("Important", [{ type: "bold" }]), f.text(" plain")]),
        f.table([["Name", "Value"], ["Example", "42"]]),
      ],
    });
    const bytes = await exportDocx(doc);
    const imported = await importDocx(bytes, { title: "Imported test", now: "2026-02-03T04:05:06.000Z" });
    expect(imported.meta.title).toBe("Imported test");
    expect(imported.sections).toHaveLength(1);
    expect(imported.sections[0]?.content.map(node => node.type)).toEqual(["heading", "paragraph", "table"]);
    expect(imported.sections[0]?.content[0]?.attrs?.level).toBe(2);
    const paragraphNode = imported.sections[0]?.content[1];
    expect(paragraphNode?.content?.[0]).toMatchObject({ type: "text", text: "Important", marks: [{ type: "bold" }] });
    const tableNode = imported.sections[0]?.content[2];
    expect(tableNode?.content).toHaveLength(2);
    expect(imported.sections[0]?.page.size.width).toBeGreaterThan(10000);
  });

  it("rejects invalid ZIP input and enforces the configured input limit", async () => {
    await expect(importDocx(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    await expect(importDocx(new Uint8Array(32), { maxInputBytes: 16 })).rejects.toThrow(/16 bytes/);
  });

  it("rejects missing document sections", async () => {
    await expect(exportDocx({ sections: [] } as never)).rejects.toThrow(/at least one section/);
  });
});
