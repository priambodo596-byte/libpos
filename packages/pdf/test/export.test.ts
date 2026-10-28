import { describe, expect, it, vi } from "vitest";
import { PDFArray, PDFDocument, PDFPage, decodePDFRawStream, type PDFRawStream } from "pdf-lib";
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

  describe("free-positioned images", () => {
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ZkAAAAASUVORK5CYII="), c => c.charCodeAt(0));
    /** Returns every `w 0 0 h x y cm` image placement found in the (Flate-compressed) page content streams. */
    const placements = async (bytes: Uint8Array) => {
      const pdf = await PDFDocument.load(bytes);
      const contents = pdf.getPage(0).node.Contents();
      const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
      let text = "";
      for (const ref of refs) {
        const stream = pdf.context.lookup(ref) as PDFRawStream;
        text += new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode()) + "\n";
      }
      // pdf-lib draws an image as: `1 0 0 1 x y cm` (translate), `1 0 0 1 0 0 cm` (no rotation), `w 0 0 h 0 0 cm` (scale).
      return [...text.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\s+1 0 0 1 0 0 cm\s+(-?[\d.]+) 0 0 (-?[\d.]+) 0 0 cm/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) }));
    };
    const build = (region: "header" | "content", attrs: Record<string, number | string>) => {
      const ids = createSequentialIdGenerator();
      const f = createNodeFactory(ids);
      const doc = createDocument({ ids, content: [f.paragraph("Body")] });
      const image = f.image("asset:logo", { alt: "Logo", width: 96, height: 48 });
      image.attrs = { ...(image.attrs ?? {}), ...attrs };
      if (region === "header") doc.sections[0]!.header = [image]; else doc.sections[0]!.content.unshift(image);
      return doc;
    };
    const resolveImage = () => ({ data: png, type: "png" as const });

    it("draws a header image at positionX/positionY (CSS px -> pt, Y axis flipped) with its size converted", async () => {
      const bytes = await exportPdf(build("header", { positionX: 200, positionY: 100, align: "right" }), { resolveImage });
      const pageHeight = (await PDFDocument.load(bytes)).getPage(0).getHeight();
      const found = (await placements(bytes)).find(p => Math.abs(p.width - 72) < 0.01);
      expect(found).toBeDefined();
      expect(found!.height).toBeCloseTo(36, 2);
      expect(found!.x).toBeCloseTo(150, 2); // 200px * 0.75
      expect(found!.y).toBeCloseTo(pageHeight - 75 - 36, 2); // top edge at 100px * 0.75 from the top
    });

    it("draws a free-positioned content image absolutely without consuming flow height", async () => {
      const bytes = await exportPdf(build("content", { positionX: 0, positionY: 0 }), { resolveImage });
      const pageHeight = (await PDFDocument.load(bytes)).getPage(0).getHeight();
      const found = (await placements(bytes)).find(p => Math.abs(p.width - 72) < 0.01);
      expect(found).toBeDefined();
      expect(found!.x).toBeCloseTo(0, 2);
      expect(found!.y).toBeCloseTo(pageHeight - 36, 2);
    });

    it("keeps a page-bound image on the page when coordinates exceed it", async () => {
      const bytes = await exportPdf(build("header", { positionX: 99999, positionY: 99999 }), { resolveImage });
      const page = (await PDFDocument.load(bytes)).getPage(0);
      const found = (await placements(bytes)).find(p => Math.abs(p.width - 72) < 0.01);
      expect(found!.x + found!.width).toBeLessThanOrEqual(page.getWidth() + 0.01);
      expect(found!.y).toBeGreaterThanOrEqual(0);
    });

    it("leaves legacy images without coordinates on their flow layout (size unchanged)", async () => {
      const bytes = await exportPdf(build("header", { align: "right" }), { resolveImage });
      const found = (await placements(bytes)).find(p => Math.abs(p.width - 96) < 0.01);
      expect(found).toBeDefined(); // legacy path keeps px value as pt, as before
    });
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

describe("PDF header/footer variants", () => {
  it("draws first-page, even-page and default regions on the right pages", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({ ids, content: [f.paragraph("p1"), f.pageBreak(), f.paragraph("p2"), f.pageBreak(), f.paragraph("p3"), f.pageBreak(), f.paragraph("p4")] });
    const s = doc.sections[0]!;
    s.header = [f.paragraph("DH")]; s.footer = [f.paragraph("DF")];
    s.firstPageHeader = [f.paragraph("FH")];
    s.evenPageHeader = [f.paragraph("EH")]; s.evenPageFooter = [f.paragraph("EF")];
    const byPage = new Map<unknown, string[]>();
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text: string) {
      byPage.set(this, [...(byPage.get(this) ?? []), text]);
    });
    try {
      await exportPdf(doc);
      const marks = [...byPage.values()].map(texts => texts.filter(t => /^(DH|DF|FH|FF|EH|EF)$/.test(t)));
      // Page 1 is first (FH; footer blank because only the header variant is defined), page 2 even, page 3 default, page 4 even.
      expect(marks).toEqual([["FH"], ["EH", "EF"], ["DH", "DF"], ["EH", "EF"]]);
    } finally { spy.mockRestore(); }
  });
});
