import { describe, expect, it } from "vitest";
import JSZip from "jszip";
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

  it("imports embedded DOCX images as editable image nodes with data URIs", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({ ids, content: [f.paragraph("Logo follows"), f.image("fixture:logo", { alt: "Test logo", width: 32, height: 32 })] });
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII="), c => c.charCodeAt(0));
    const bytes = await exportDocx(doc, { resolveImage: async () => ({ data: png, type: "png" }) });
    const imported = await importDocx(bytes);
    const images = imported.sections[0]?.content.filter(node => node.type === "image") ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]?.attrs).toMatchObject({ alt: "Imported image", width: 32, height: 32 });
    expect(images[0]?.attrs?.src).toContain("data:image/png;base64,");
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
    expect(imported.sections[0]?.page.size.width).toBeLessThan(13000);
    expect(imported.sections[0]?.page.margins.left).toBeGreaterThan(1000);
    expect(imported.sections[0]?.page.margins.left).toBeLessThan(2000);
  });

  it("imports adjacent Word numbering paragraphs as a structured ordered list", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Second</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
    zip.file("word/numbering.xml", `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="0"/></w:num></w:numbering>`);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const imported = await importDocx(bytes);
    const list = imported.sections[0]?.content[0];
    expect(list?.type).toBe("orderedList");
    expect(list?.attrs?.start).toBe(3);
    expect(list?.content).toHaveLength(2);
    expect(list?.content?.[0]).toMatchObject({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] });
  });

  it("rejects invalid ZIP input and enforces the configured input limit", async () => {
    await expect(importDocx(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    await expect(importDocx(new Uint8Array(32), { maxInputBytes: 16 })).rejects.toThrow(/16 bytes/);
  });

  it("rejects missing document sections", async () => {
    await expect(exportDocx({ sections: [] } as never)).rejects.toThrow(/at least one section/);
  });
});
