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

  it("rejects documents without sections", async () => {
    await expect(exportPdf({ sections: [] } as never)).rejects.toThrow(/at least one section/);
  });
});
