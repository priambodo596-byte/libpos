import { describe, expect, it } from "vitest";
import { createDocument, createNodeFactory, createSequentialIdGenerator, defaultPageSetup } from "@convetlib/core";
import { paginateDocument } from "../src/pagination";

function smallPage() {
  return {
    size: { width: 1000, height: 1000 },
    orientation: "portrait" as const,
    margins: { top: 100, right: 100, bottom: 100, left: 100, header: 40, footer: 40 },
  };
}

describe("block pagination foundation", () => {
  it("flows measured top-level blocks to a new page when the content area is full", () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const doc = createDocument({ ids, page: smallPage(), content: [f.paragraph("A"), f.paragraph("B"), f.paragraph("C")] });
    const heights = new Map(doc.sections[0]!.content.map((block, i) => [block.id, [300, 300, 250][i]!]));
    const result = paginateDocument(doc, block => heights.get(block.id)!);
    expect(result.totalPages).toBe(2);
    expect(result.pages.map(page => page.blocks.map(block => block.blockId))).toEqual([
      [doc.sections[0]!.content[0]!.id, doc.sections[0]!.content[1]!.id],
      [doc.sections[0]!.content[2]!.id],
    ]);
    expect(result.pages[1]).toMatchObject({ pageNumber: 2, sectionPageNumber: 2, contentWidth: 800, contentHeight: 800, usedHeight: 250 });
    expect(result.pages[1]!.blocks[0]!.y).toBe(0);
  });

  it("honors explicit page breaks and does not create an extra blank page at the end", () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const doc = createDocument({ ids, page: smallPage(), content: [f.paragraph("A"), f.pageBreak(), f.paragraph("B"), f.pageBreak()] });
    const result = paginateDocument(doc, () => 100);
    expect(result.pages.map(page => page.blocks.map(block => block.type))).toEqual([["paragraph"], ["paragraph"]]);
  });

  it("starts each document section on its own page and resets the section page number", () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const doc = createDocument({ ids, page: smallPage(), content: [f.paragraph("A")] });
    doc.sections.push({ id: ids(), page: { ...defaultPageSetup(), size: { width: 2000, height: 3000 }, margins: { top: 200, right: 200, bottom: 200, left: 200, header: 80, footer: 80 } }, content: [f.paragraph("B")] });
    const result = paginateDocument(doc, () => 100);
    expect(result.pages.map(page => page.sectionPageNumber)).toEqual([1, 1]);
    expect(result.pages.map(page => page.contentWidth)).toEqual([800, 1600]);
  });

  it("reports an oversized indivisible block instead of silently splitting it", () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const doc = createDocument({ ids, page: smallPage(), content: [f.paragraph("too tall"), f.paragraph("next")] });
    const result = paginateDocument(doc, block => block.id === doc.sections[0]!.content[0]!.id ? 900 : 100);
    expect(result.pages[0]).toMatchObject({ overflow: true, usedHeight: 900 });
    expect(result.pages[0]!.blocks).toHaveLength(1);
    expect(result.pages[1]!.overflow).toBe(false);
  });

  it("keeps a heading with its following block when the pair fits on a fresh page", () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const heading = f.heading(2, "Section title");
    heading.attrs = { ...heading.attrs, keepWithNext: true };
    const body = f.paragraph("Section body");
    const doc = createDocument({ ids, page: smallPage(), content: [f.paragraph("Previous content"), heading, body] });
    const heights = new Map([[doc.sections[0]!.content[0]!.id, 500], [heading.id, 200], [body.id, 200]]);
    const result = paginateDocument(doc, block => heights.get(block.id)!);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]!.blocks.map(block => block.blockId)).toEqual([doc.sections[0]!.content[0]!.id]);
    expect(result.pages[1]!.blocks.map(block => block.blockId)).toEqual([heading.id, body.id]);
  });

  it("does not move a keep-with-next pair when it cannot fit on any page", () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const heading = f.heading(2, "Large title");
    heading.attrs = { ...heading.attrs, keepWithNext: true };
    const body = f.paragraph("Large content");
    const doc = createDocument({ ids, page: smallPage(), content: [heading, body] });
    const heights = new Map([[heading.id, 500], [body.id, 400]]);
    const result = paginateDocument(doc, block => heights.get(block.id)!);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]!.blocks[0]!.blockId).toBe(heading.id);
    expect(result.pages[0]!.overflow).toBe(false);
    expect(result.pages[1]!.blocks[0]!.blockId).toBe(body.id);
  });

  it("selects and measures first-page, even-page, and default headers/footers", () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const doc = createDocument({ ids, page: smallPage(), content: [f.paragraph("page one"), f.paragraph("page two"), f.paragraph("page three")] });
    const section = doc.sections[0]!;
    section.header = [f.paragraph("default header")];
    section.footer = [f.paragraph("default footer")];
    section.firstPageHeader = [f.paragraph("first header")];
    section.firstPageFooter = [f.paragraph("first footer")];
    section.evenPageHeader = [f.paragraph("even header")];
    section.evenPageFooter = [f.paragraph("even footer")];
    const labels = new Map<string, number>([
      [section.firstPageHeader[0]!.id, 40], [section.firstPageFooter[0]!.id, 20],
      [section.evenPageHeader[0]!.id, 30], [section.evenPageFooter[0]!.id, 10],
      [section.header[0]!.id, 15], [section.footer[0]!.id, 5],
    ]);
    const result = paginateDocument(doc, block => labels.get(block.id) ?? 700);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]).toMatchObject({ headerHeight: 40, footerHeight: 20 });
    expect(result.pages[0]!.header[0]!.blockId).toBe(section.firstPageHeader[0]!.id);
    expect(result.pages[0]!.footer[0]!.blockId).toBe(section.firstPageFooter[0]!.id);
    expect(result.pages[1]).toMatchObject({ headerHeight: 30, footerHeight: 10 });
    expect(result.pages[1]!.header[0]!.blockId).toBe(section.evenPageHeader[0]!.id);
    expect(result.pages[1]!.footer[0]!.blockId).toBe(section.evenPageFooter[0]!.id);
    expect(result.pages[2]).toMatchObject({ headerHeight: 15, footerHeight: 5 });
    expect(result.pages[2]!.header[0]!.blockId).toBe(section.header[0]!.id);
    expect(result.pages[2]!.footer[0]!.blockId).toBe(section.footer[0]!.id);
  });

  it("rejects invalid page geometry and invalid measured heights", () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const doc = createDocument({ ids, page: smallPage(), content: [f.paragraph("A")] });
    expect(() => paginateDocument(doc, () => Number.NaN)).toThrow(/Invalid measured height/);
    doc.sections[0]!.page.margins.left = 900;
    expect(() => paginateDocument(doc, () => 10)).toThrow(/positive content area/);
  });
});
