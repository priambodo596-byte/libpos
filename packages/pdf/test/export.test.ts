import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createDocument, createNodeFactory, createSequentialIdGenerator } from "@convetlib/core";
import { exportPdf } from "../src/index";

describe("PDF export adapter", () => {
  it("creates a readable PDF for paragraphs, headings, simple tables and explicit page breaks", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({
      ids,
      title: "PDF test",
      content: [
        f.heading(1, "Document title"),
        f.paragraph("A paragraph with a placeholder: " + "{{ invoice.number }}"),
        f.table([["Name", "Value"], ["Example", "42"]]),
        f.pageBreak(),
        f.paragraph("Second page"),
      ],
    });
    const bytes = await exportPdf(doc);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getTitle()).toBe("PDF test");
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it("automatically adds pages when the text exceeds the page content area", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const text = Array.from({ length: 180 }, (_, i) => "Line " + (i + 1) + " with enough words to wrap across the document page.");
    const doc = createDocument({ ids, content: text.map(line => f.paragraph(line)) });
    const bytes = await exportPdf(doc);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
  });

  it("wraps long table cells and continues rows onto subsequent pages", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const rows = [["Item", "Description"], ...Array.from({ length: 70 }, (_, i) => [String(i + 1), `A long description for row ${i + 1} that should wrap inside a table cell rather than overflow its column.`])];
    const doc = createDocument({ ids, content: [f.table(rows)] });
    const bytes = await exportPdf(doc);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
    expect(bytes.byteLength).toBeGreaterThan(3000);
  });

  it("supports weighted column widths stored on the table node", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const table = f.table([["Wide column", "Narrow"], ["Longer content fits the wide column", "x"]]);
    table.attrs = { columnWidths: [3, 1] };
    const doc = createDocument({ ids, content: [table] });
    const bytes = await exportPdf(doc);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("embeds resolved PNG image bytes in the exported PDF", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({ ids, content: [f.image("asset:logo", { alt: "Company logo", width: 24, height: 24 })] });
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ZkAAAAASUVORK5CYII="), c => c.charCodeAt(0));
    const bytes = await exportPdf(doc, { resolveImage: source => {
      expect(source).toBe("asset:logo");
      return { data: png, type: "png" };
    } });
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(png.byteLength);
  });

  it("embeds an aligned image from the document section header", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({ ids, title: "Header image", content: [f.paragraph("Body content")] });
    const image = f.image("asset:header-logo", { alt: "Header logo", width: 24, height: 24 });
    image.attrs = { ...(image.attrs ?? {}), align: "right" };
    doc.sections[0]!.header = [image];
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ZkAAAAASUVORK5CYII="), c => c.charCodeAt(0));
    const bytes = await exportPdf(doc, { resolveImage: source => {
      expect(source).toBe("asset:header-logo");
      return { data: png, type: "png" };
    } });
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(png.byteLength);
  });

  it("adds repeating headers, custom footers, and page-number tokens", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({ ids, content: [f.paragraph("First page"), f.pageBreak(), f.paragraph("Second page")] });
    const bytes = await exportPdf(doc, { header: "CONFIDENTIAL", footer: "Page {{pageNumber}} / {{pageCount}}" });
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(2);
    expect(loaded.getPages()).toHaveLength(2);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("renders bold, italic, underline, and strike text runs", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({ ids, content: [f.paragraph([
      f.text("bold", [{ type: "bold" }]),
      f.text(" italic", [{ type: "italic" }]),
      f.text(" underline", [{ type: "underline" }]),
      f.text(" strike", [{ type: "strike" }]),
    ])] });
    const bytes = await exportPdf(doc);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("requires base font bytes when custom font variants are supplied", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({ ids, content: [f.paragraph("font test")] });
    await expect(exportPdf(doc, { boldFontBytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow(/fontBytes is required/);
  });

  it("rejects documents without sections", async () => {
    await expect(exportPdf({ sections: [] } as never)).rejects.toThrow(/at least one section/);
  });
});
