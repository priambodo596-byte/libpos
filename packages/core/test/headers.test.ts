import { describe, expect, it } from "vitest";
import { resolveSectionHeaderFooter, sectionUsesEvenPageVariant, sectionUsesFirstPageVariant, type BlockNode, type Section } from "../src/index";

const block = (id: string): BlockNode => ({ type: "paragraph", id, content: [] });
const base = (extra: Partial<Section> = {}): Section => ({
  id: "s", page: { size: { width: 11906, height: 16838 }, orientation: "portrait", margins: { top: 1, right: 1, bottom: 1, left: 1, header: 1, footer: 1 } },
  header: [block("dh")], footer: [block("df")], content: [block("c")], ...extra,
});
const ids = (blocks: readonly BlockNode[]) => blocks.map(b => b.id);

describe("resolveSectionHeaderFooter", () => {
  it("uses the default regions when no variant is defined", () => {
    const s = base();
    expect(sectionUsesFirstPageVariant(s)).toBe(false);
    expect(sectionUsesEvenPageVariant(s)).toBe(false);
    for (const [pageNumber, isFirstPageOfSection] of [[1, true], [2, false], [3, false]] as const) {
      const r = resolveSectionHeaderFooter(s, { pageNumber, isFirstPageOfSection });
      expect([ids(r.header), ids(r.footer)]).toEqual([["dh"], ["df"]]);
    }
  });
  it("applies first-page and even-page variants with first-page precedence", () => {
    const s = base({ firstPageHeader: [block("fh")], evenPageHeader: [block("eh")], evenPageFooter: [block("ef")] });
    expect(ids(resolveSectionHeaderFooter(s, { pageNumber: 1, isFirstPageOfSection: true }).header)).toEqual(["fh"]);
    expect(ids(resolveSectionHeaderFooter(s, { pageNumber: 2, isFirstPageOfSection: false }).header)).toEqual(["eh"]);
    expect(ids(resolveSectionHeaderFooter(s, { pageNumber: 3, isFirstPageOfSection: false }).header)).toEqual(["dh"]);
    // Page 2 that starts a new section is "first" there, so the first-page variant applies, not the even one.
    expect(ids(resolveSectionHeaderFooter(s, { pageNumber: 2, isFirstPageOfSection: true }).header)).toEqual(["fh"]);
  });
  it("blanks the undefined region of an enabled variant", () => {
    const s = base({ firstPageHeader: [block("fh")] });
    const r = resolveSectionHeaderFooter(s, { pageNumber: 1, isFirstPageOfSection: true });
    expect(ids(r.header)).toEqual(["fh"]);
    expect(r.footer).toEqual([]);
  });
});
