import type { BlockNode, Section } from "./types";

/** True when the section defines a first-page header or footer (Word "different first page"). */
export function sectionUsesFirstPageVariant(section: Section): boolean {
  return section.firstPageHeader !== undefined || section.firstPageFooter !== undefined;
}

/** True when the section defines an even-page header or footer (Word "different odd & even pages"). */
export function sectionUsesEvenPageVariant(section: Section): boolean {
  return section.evenPageHeader !== undefined || section.evenPageFooter !== undefined;
}

export interface HeaderFooterPage {
  /** 1-based page number in the document; parity decides odd/even. */
  readonly pageNumber: number;
  /** True for the first page of the section. */
  readonly isFirstPageOfSection: boolean;
}

/**
 * Picks the header and footer blocks that apply to a page. The first-page variant wins over the even-page variant,
 * which wins over the default. When a variant is enabled but one of its two regions is undefined, that region is blank.
 */
export function resolveSectionHeaderFooter(section: Section, page: HeaderFooterPage): { header: readonly BlockNode[]; footer: readonly BlockNode[] } {
  if (page.isFirstPageOfSection && sectionUsesFirstPageVariant(section)) {
    return { header: section.firstPageHeader ?? [], footer: section.firstPageFooter ?? [] };
  }
  if (page.pageNumber % 2 === 0 && sectionUsesEvenPageVariant(section)) {
    return { header: section.evenPageHeader ?? [], footer: section.evenPageFooter ?? [] };
  }
  return { header: section.header ?? [], footer: section.footer ?? [] };
}
