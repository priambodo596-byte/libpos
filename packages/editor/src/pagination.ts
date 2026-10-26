import type { BlockNode, DocumentJSON, PageSetup, Section } from "@convetlib/core";

export interface BlockMeasureContext {
  readonly section: Section;
  readonly availableWidth: number;
  readonly pageSetup: PageSetup;
}

/** Return a block's laid-out height in twips. The host renderer owns font and line measurement. */
export type MeasureBlock = (block: BlockNode, context: BlockMeasureContext) => number;

export interface BlockPlacement {
  readonly blockId: string;
  readonly type: string;
  /** Vertical offset from the top of the content area, in twips. */
  readonly y: number;
  readonly height: number;
  readonly sourceIndex: number;
}

export interface DocumentPage {
  readonly pageNumber: number;
  readonly sectionId: string;
  readonly sectionPageNumber: number;
  readonly pageSetup: PageSetup;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly usedHeight: number;
  readonly overflow: boolean;
  readonly blocks: readonly BlockPlacement[];
}

export interface PaginationResult {
  readonly pages: readonly DocumentPage[];
  readonly totalPages: number;
}

/**
 * Paginates top-level blocks using host-supplied measurements.
 *
 * This is a layout foundation, not a text shaping engine: blocks are kept intact,
 * explicit pageBreak nodes start a new page, and oversized blocks are reported
 * rather than split. Header/footer rendering and line-level paragraph splitting
 * belong to a future renderer/layout stage.
 */
export function paginateDocument(document: DocumentJSON, measureBlock: MeasureBlock): PaginationResult {
  if (typeof measureBlock !== "function") throw new TypeError("measureBlock must be a function");
  const pages: DocumentPage[] = [];

  document.sections.forEach((section) => {
    const setup = section.page;
    const contentWidth = setup.size.width - setup.margins.left - setup.margins.right;
    const contentHeight = setup.size.height - setup.margins.top - setup.margins.bottom;
    if (!Number.isFinite(contentWidth) || !Number.isFinite(contentHeight) || contentWidth <= 0 || contentHeight <= 0) {
      throw new RangeError("Page size and margins must leave a positive content area");
    }

    let sectionPageNumber = 0;
    let blocks: BlockPlacement[] = [];
    let usedHeight = 0;
    let overflow = false;

    const flushPage = () => {
      if (blocks.length === 0 && sectionPageNumber > 0) return;
      sectionPageNumber += 1;
      pages.push({
        pageNumber: pages.length + 1,
        sectionId: section.id,
        sectionPageNumber,
        pageSetup: setup,
        contentWidth,
        contentHeight,
        usedHeight,
        overflow,
        blocks,
      });
      blocks = [];
      usedHeight = 0;
      overflow = false;
    };

    const measured = section.content.map((block, sourceIndex) => {
      if (block.type === "pageBreak") return { block, sourceIndex, height: 0 };
      const height = measureBlock(block, { section, availableWidth: contentWidth, pageSetup: setup });
      if (!Number.isFinite(height) || height < 0) {
        throw new RangeError(`Invalid measured height for block ${block.id}: ${height}`);
      }
      return { block, sourceIndex, height };
    });

    for (let index = 0; index < measured.length; index += 1) {
      const current = measured[index]!;
      const { block, sourceIndex, height } = current;
      if (block.type === "pageBreak") {
        if (blocks.length > 0) flushPage();
        continue;
      }

      const next = measured[index + 1];
      const keepWithNext = block.attrs?.keepWithNext === true;
      const pairHeight = next && next.block.type !== "pageBreak" ? height + next.height : height;
      const pairFitsPage = pairHeight <= contentHeight;
      const pairWouldOverflow = usedHeight + pairHeight > contentHeight;
      if (blocks.length > 0 && (usedHeight + height > contentHeight || (keepWithNext && pairFitsPage && pairWouldOverflow))) {
        flushPage();
      }

      blocks.push({ blockId: block.id, type: block.type, y: usedHeight, height, sourceIndex });
      usedHeight += height;
      if (height > contentHeight) overflow = true;
    }

    if (blocks.length > 0 || sectionPageNumber === 0) flushPage();
  });

  return { pages, totalPages: pages.length };
}
