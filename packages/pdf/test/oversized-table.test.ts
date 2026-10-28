import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { createDocument, createNodeFactory, createSequentialIdGenerator } from "@convetlib/core";
import { exportPdf } from "../src/index";

describe("PDF oversized table rows", () => {
  it("splits an exceptionally tall single-row table across pages without dropping text", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const longText = Array.from({ length: 900 }, (_, i) => `entry${i}`).join(" ");
    const node = f.block("table", [f.block("tableRow", [f.block("tableCell", [f.paragraph(longText)])])]);
    const drawnText: string[] = [];
    const rectanglePages = new Set<PDFPage>();
    const textSpy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text: string) { drawnText.push(text); return this; });
    const rectSpy = vi.spyOn(PDFPage.prototype, "drawRectangle").mockImplementation(function (this: PDFPage) { rectanglePages.add(this); return this; });
    try {
      const bytes = await exportPdf(createDocument({ ids, content: [node] }));
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBeGreaterThan(1);
      expect(rectanglePages.size).toBe(pdf.getPageCount());
      expect(drawnText.join(" ")).toContain("entry0");
      expect(drawnText.join(" ")).toContain("entry899");
      expect(drawnText.length).toBeGreaterThan(50);
    } finally { textSpy.mockRestore(); rectSpy.mockRestore(); }
  });

  it("splits an oversized rowspan group across pages and preserves merged-cell content", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const longText = Array.from({ length: 900 }, (_, i) => `merged${i}`).join(" ");
    const node = f.block("table", [
      f.block("tableRow", [f.block("tableCell", [f.paragraph(longText)], { rowspan: 2 }), f.block("tableCell", [f.paragraph("top row")])]),
      f.block("tableRow", [f.block("tableCell", [f.paragraph("bottom row")])]),
    ]);
    const drawnText: string[] = [];
    const rectanglePages = new Set<PDFPage>();
    const textSpy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text: string) { drawnText.push(text); return this; });
    const rectSpy = vi.spyOn(PDFPage.prototype, "drawRectangle").mockImplementation(function (this: PDFPage) { rectanglePages.add(this); return this; });
    try {
      const bytes = await exportPdf(createDocument({ ids, content: [node] }));
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBeGreaterThan(1);
      expect(rectanglePages.size).toBe(pdf.getPageCount());
      expect(drawnText.join(" ")).toContain("merged0");
      expect(drawnText.join(" ")).toContain("merged899");
      expect(drawnText.join(" ")).toContain("top row");
      expect(drawnText.join(" ")).toContain("bottom row");
    } finally { textSpy.mockRestore(); rectSpy.mockRestore(); }
  });
});
