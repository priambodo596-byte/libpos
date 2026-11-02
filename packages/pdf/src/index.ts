import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { OFFICIAL_DOCUMENT_PROFILE, pageSetupForOrientation, resolveSectionHeaderFooter, type BlockNode, type DocumentJSON, type DocumentStyleProfile, type PageSetup, type Section } from "@convetlib/core";
import { buildTableGrid, computeRowHeights, rowGroups, type GridCell } from "./table-layout";

export interface PdfExportOptions {
  /** Font size in points for normal body text. Defaults to 11. */
  fontSize?: number;
  /** Optional custom TrueType/OpenType font bytes; embed and subset into the PDF. */
  fontBytes?: Uint8Array;
  /** Optional bold font bytes for marked runs. Falls back to fontBytes or standard Helvetica Bold. */
  boldFontBytes?: Uint8Array;
  /** Optional italic font bytes for marked runs. Falls back to fontBytes or standard Helvetica Oblique. */
  italicFontBytes?: Uint8Array;
  /** Optional bold-italic font bytes for marked runs. */
  boldItalicFontBytes?: Uint8Array;
  /** Extra vertical gap after each paragraph, in points. Defaults to 5. */
  paragraphGap?: number;
  /** Resolve an image source to binary data. Remote URLs are never fetched implicitly. */
  resolveImage?: (source: string) => Promise<{ data: Uint8Array; type: "png" | "jpg" }> | { data: Uint8Array; type: "png" | "jpg" };
  /** Optional repeating header text; supports {{pageNumber}} and {{pageCount}} tokens. */
  header?: string;
  /** Optional repeating footer text; supports {{pageNumber}} and {{pageCount}} tokens. */
  footer?: string;
  /** Draw a default "Page N of M" footer when no custom footer is provided. */
  pageNumbering?: boolean;
  /** Field values keyed by placeholder key. Placeholder tokens ({{key}}) resolve to these values when set. */
  fieldValues?: Record<string, string>;
  /** Overrides the shared official-document typography defaults for this export. */
  profile?: Partial<Omit<DocumentStyleProfile, "headingSizesPt">> & { headingSizesPt?: DocumentStyleProfile["headingSizesPt"] };
}

function twipsToPoints(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value / 20 : fallback;
}

function safePdfText(value: string, unicode = false): string {
  // Standard PDF fonts use WinAnsi; custom embedded fonts can represent broader Unicode.
  return unicode ? value : value.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
}

function nodeText(node: BlockNode, options?: { fieldValues?: Record<string, string> }): string {
  if (node.type === "image") {
    const alt = node.attrs?.alt;
    return "[Image" + (typeof alt === "string" ? ": " + alt : "") + "]";
  }
  return (node.content ?? []).map(child => {
    if (child.type === "text") return (child as { text: string }).text;
    if ("id" in child) return nodeText(child as BlockNode, options);
    if (child.type === "placeholder") {
      const attrs = (child as { attrs?: Record<string, unknown> }).attrs;
      const key = typeof attrs?.key === "string" ? attrs.key : "unknown";
      const token = "{{ " + key + " }}";
      const value = options?.fieldValues?.[key];
      const fallback = typeof attrs?.fallback === "string" ? attrs.fallback : undefined;
      return typeof value === "string" && value ? value : (fallback ?? token);
    }
    if (child.type === "pageNumber") return "{{ pageNumber }}";
    if (child.type === "pageCount") return "{{ pageCount }}";
    return "";
  }).join("");
}

function pageDimensions(setup: PageSetup) {
  return {
    width: twipsToPoints(setup.size.width, 595.3),
    height: twipsToPoints(setup.size.height, 841.9),
    left: twipsToPoints(setup.margins.left, 72),
    right: twipsToPoints(setup.margins.right, 72),
    top: twipsToPoints(setup.margins.top, 72),
    bottom: twipsToPoints(setup.margins.bottom, 72),
  };
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, unicode = false): string[] {
  const normalized = safePdfText(text, unicode).replace(/\r/g, "");
  const lines: string[] = [];
  for (const rawLine of normalized.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Export a document to PDF using built-in Times-family fonts by default; custom embedded fonts can be supplied for broader Unicode and exact host typography.
 * This is a semantic text-first renderer; it does not promise HTML/CSS pixel parity.
 */
/** CSS px (96 dpi) to PDF points (72 dpi). Model coordinates positionX/positionY are CSS px from the page's top-left corner. */
const PX_TO_PT = 0.75;
/**
 * Resolves the absolute page rectangle of a free-positioned image, in PDF points with a bottom-left origin.
 * Returns undefined when the node has no (valid) positionX/positionY, so legacy images keep their flow layout.
 */
function freeImageRect(attrs: Record<string, unknown> | undefined, natural: { width: number; height: number }, page: { width: number; height: number }): { x: number; y: number; width: number; height: number } | undefined {
  const px = attrs?.positionX;
  const py = attrs?.positionY;
  if (typeof px !== "number" || typeof py !== "number" || !Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0) return undefined;
  const w = typeof attrs?.width === "number" && attrs.width > 0 ? attrs.width : natural.width;
  const h = typeof attrs?.height === "number" && attrs.height > 0 ? attrs.height : natural.height;
  // Keep absolute images fully inside the physical page while preserving their aspect ratio.
  const requestedWidth = w * PX_TO_PT;
  const requestedHeight = h * PX_TO_PT;
  const scale = Math.min(1, page.width / requestedWidth, page.height / requestedHeight);
  const width = requestedWidth * scale;
  const height = requestedHeight * scale;
  // PDF's Y axis points up while CSS' points down, so flip against the page height.
  const x = Math.min(px * PX_TO_PT, Math.max(0, page.width - width));
  const y = Math.max(0, Math.min(page.height - py * PX_TO_PT - height, page.height - height));
  return { x, y, width, height };
}

type MeaningfulNode = { type: string; text?: string; content?: readonly MeaningfulNode[] };

function hasMeaningfulNodes(nodes: readonly MeaningfulNode[] | undefined): boolean {
  return (nodes ?? []).some((node) => {
    if (node.type === 'image' || node.type === 'table' || node.type === 'horizontalRule' || node.type === 'pageBreak') return true;
    if (node.type === 'text') return Boolean(node.text?.trim());
    if (node.type === 'placeholder' || node.type === 'hardBreak') return true;
    return hasMeaningfulNodes(node.content);
  });
}

function isEmptyLeadingSection(section: Section): boolean {
  const regions = [section.header, section.content, section.footer, section.firstPageHeader, section.firstPageFooter, section.evenPageHeader, section.evenPageFooter];
  return !regions.some((region) => hasMeaningfulNodes(region as readonly MeaningfulNode[] | undefined));
}

function sectionsForExport(sections: readonly Section[]): Section[] {
  const result = [...sections];
  // The playground's initial empty flow section is only a starter page, not document content.
  // Remove only leading empty sections and always preserve at least one page for a blank document.
  while (result.length > 1 && isEmptyLeadingSection(result[0]!)) result.shift();
  return result;
}

export async function exportPdf(document: DocumentJSON, options: PdfExportOptions = {}): Promise<Uint8Array> {
  if (!document || !Array.isArray(document.sections) || document.sections.length === 0) {
    throw new TypeError("A document with at least one section is required");
  }
  const pdf = await PDFDocument.create();
  pdf.setTitle(document.meta.title || "Untitled");
  let regular: PDFFont;
  let bold: PDFFont;
  let italic: PDFFont;
  let boldItalic: PDFFont;
  if (options.fontBytes || options.boldFontBytes || options.italicFontBytes || options.boldItalicFontBytes) {
    pdf.registerFontkit(fontkit);
    const base = options.fontBytes;
    if (!base) throw new TypeError("fontBytes is required when custom font variants are provided");
    regular = await pdf.embedFont(base, { subset: true });
    bold = options.boldFontBytes ? await pdf.embedFont(options.boldFontBytes, { subset: true }) : await pdf.embedFont(StandardFonts.TimesRomanBold);
    italic = options.italicFontBytes ? await pdf.embedFont(options.italicFontBytes, { subset: true }) : await pdf.embedFont(StandardFonts.TimesRomanItalic);
    boldItalic = options.boldItalicFontBytes ? await pdf.embedFont(options.boldItalicFontBytes, { subset: true }) : await pdf.embedFont(StandardFonts.TimesRomanBoldItalic);
  } else {
    // Match the enterprise DOCX default (Times New Roman family) as closely as the
    // built-in PDF fonts allow. Hosts can embed Times New Roman bytes for exact typography.
    regular = await pdf.embedFont(StandardFonts.TimesRoman);
    bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
    italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
    boldItalic = await pdf.embedFont(StandardFonts.TimesRomanBoldItalic);
  }
  const profile = { ...OFFICIAL_DOCUMENT_PROFILE, ...options.profile };
  const bodySize = Math.max(6, Math.min(36, options.fontSize ?? profile.fontSizePt));
  const paragraphGap = Math.max(0, Math.min(48, options.paragraphGap ?? profile.paragraphSpacingAfterPt));
  const lineSpacing = Math.max(1, Math.min(3, profile.paragraphLineSpacing));
  const pageLayouts: Array<{ page: PDFPage; dimensions: ReturnType<typeof pageDimensions>; section: Section }> = [];

  const exportSections = sectionsForExport(document.sections).map(section => options.profile?.page && section.kind !== "canvas"
    ? { ...section, page: pageSetupForOrientation(options.profile.page, section.page.orientation) }
    : section);
  for (const section of exportSections) {
    const dimensions = pageDimensions(section.page);
    let page: PDFPage = pdf.addPage([dimensions.width, dimensions.height]);
    pageLayouts.push({ page, dimensions, section });
    let y = dimensions.height - dimensions.top;
    const maxWidth = dimensions.width - dimensions.left - dimensions.right;
    const lineHeight = bodySize * lineSpacing;

    const newPage = (setup: PageSetup = section.page) => {
      const d = pageDimensions(setup);
      page = pdf.addPage([d.width, d.height]);
      pageLayouts.push({ page, dimensions: d, section });
      y = d.height - d.top;
    };
    const ensureSpace = (height: number) => {
      if (y - height < dimensions.bottom) newPage();
    };
    const drawWrapped = (text: string, font: PDFFont, size: number, gapAfter = 0, align: unknown = "left") => {
      const lines = wrapText(text, font, size, maxWidth, Boolean(options.fontBytes));
      for (const line of lines) {
        ensureSpace(size * lineSpacing);
        const lineWidth = font.widthOfTextAtSize(safePdfText(line, Boolean(options.fontBytes)), size);
        const normalizedAlign = align === "center" || align === "right" || align === "justify" ? align : "left";
        const x = normalizedAlign === "center" ? dimensions.left + Math.max(0, (maxWidth - lineWidth) / 2) : normalizedAlign === "right" ? dimensions.left + Math.max(0, maxWidth - lineWidth) : dimensions.left;
        page.drawText(line, { x, y: y - size, size, font, color: rgb(0, 0, 0) });
        y -= size * lineSpacing;
      }
      y -= gapAfter;
    };

    const drawRichBlock = (block: BlockNode, baseSize: number, defaultFont: PDFFont) => {
      const inline = block.content ?? [];
      const runs = inline.map(item => {
        if (item.type === "text") {
          const textNode = item as { text: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> };
          const marks = textNode.marks ?? [];
          const isBold = marks.some(mark => mark.type === "bold");
          const isItalic = marks.some(mark => mark.type === "italic");
          const font = isBold && isItalic ? boldItalic : isBold ? bold : isItalic ? italic : defaultFont;
          const style = marks.find(mark => mark.type === "textStyle")?.attrs ?? {};
          const color = typeof style.color === "string" && /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : "#000000";
          return { text: textNode.text, font, color, underline: marks.some(mark => mark.type === "underline"), strike: marks.some(mark => mark.type === "strike") };
        }
        if (item.type === "hardBreak") return { text: "\n", font: defaultFont, color: "#000000", underline: false, strike: false };
        if (item.type === "placeholder") {
          const attrs = (item as { attrs?: Record<string, unknown> }).attrs;
          const key = typeof attrs?.key === "string" ? attrs.key : "unknown";
          const value = options.fieldValues?.[key];
          const fallback = typeof attrs?.fallback === "string" ? attrs.fallback : undefined;
          return { text: typeof value === "string" && value ? value : (fallback ?? "{{ " + key + " }}"), font: defaultFont, color: "#000000", underline: false, strike: false };
        }
        return { text: "", font: defaultFont, color: "#000000", underline: false, strike: false };
      }).filter(run => run.text.length > 0);
      const tokens = runs.flatMap(run => (run.text.match(/\s+|[^\s]+/gu) ?? []).map(text => ({ ...run, text })));
      let line = [] as typeof tokens;
      const widthOf = (parts: typeof tokens) => parts.reduce((sum, part) => sum + part.font.widthOfTextAtSize(part.text, baseSize), 0);
      const drawLine = () => {
        if (!line.length) { y -= baseSize * lineSpacing; return; }
        ensureSpace(baseSize * 1.5);
        let x = dimensions.left;
        const lineY = y - baseSize;
        for (const part of line) {
          const clean = safePdfText(part.text, Boolean(options.fontBytes));
          const width = part.font.widthOfTextAtSize(clean, baseSize);
          const hex = part.color.slice(1); const red = Number.parseInt(hex.slice(0, 2), 16) / 255; const green = Number.parseInt(hex.slice(2, 4), 16) / 255; const blue = Number.parseInt(hex.slice(4, 6), 16) / 255; const textColor = rgb(red, green, blue);
          page.drawText(clean, { x, y: lineY, size: baseSize, font: part.font, color: textColor });
          if (part.underline) page.drawLine({ start: { x, y: lineY - 1 }, end: { x: x + width, y: lineY - 1 }, thickness: 0.5, color: rgb(0, 0, 0) });
          if (part.strike) page.drawLine({ start: { x, y: lineY + baseSize * 0.35 }, end: { x: x + width, y: lineY + baseSize * 0.35 }, thickness: 0.5, color: rgb(0, 0, 0) });
          x += width;
        }
        y -= baseSize * lineSpacing;
        line = [];
      };
      for (const token of tokens) {
        if (token.text.includes("\n")) { drawLine(); continue; }
        if (line.length && widthOf([...line, token]) > maxWidth && !/^\s+$/u.test(token.text)) drawLine();
        if (!line.length && /^\s+$/u.test(token.text)) continue;
        line.push(token);
      }
      if (line.length) drawLine();
      y -= paragraphGap;
    };

    for (let blockIndex = 0; blockIndex < section.content.length; blockIndex += 1) {
      const block = section.content[blockIndex]!;
      if (block.type === "heading") {
        // Keep a heading with the following text block where possible, avoiding a heading stranded at the bottom of a page.
        const level = typeof block.attrs?.level === "number" ? block.attrs.level : 1;
        const headingSize = Math.max(bodySize, (options.profile?.headingSizesPt ?? OFFICIAL_DOCUMENT_PROFILE.headingSizesPt)[Math.min(2, Math.max(0, level - 1))]!);
        const headingLines = Math.max(1, wrapText(nodeText(block, options), bold, headingSize, maxWidth, Boolean(options.fontBytes)).length);
        const next = section.content[blockIndex + 1];
        const nextIsText = next && ["paragraph", "heading", "listItem", "bulletList", "orderedList"].includes(next.type);
        const nextLines = nextIsText ? Math.max(1, wrapText(nodeText(next, options), regular, bodySize, maxWidth, Boolean(options.fontBytes)).length) : 0;
        if (nextLines) ensureSpace(headingLines * headingSize * lineSpacing + nextLines * bodySize * lineSpacing + paragraphGap * 2);
      }
      if (block.type === "image") {
        const source = block.attrs?.src;
        let embedded: Awaited<ReturnType<typeof pdf.embedPng>> | Awaited<ReturnType<typeof pdf.embedJpg>> | undefined;
        if (typeof source === "string" && options.resolveImage) {
          try {
            const resolved = await options.resolveImage(source);
            embedded = resolved.type === "png" ? await pdf.embedPng(resolved.data) : await pdf.embedJpg(resolved.data);
          } catch {
            embedded = undefined;
          }
        }
        const freeContent = embedded ? freeImageRect(block.attrs, embedded, dimensions) : undefined;
        if (embedded && freeContent) {
          // Free-positioned content image: absolute on the page where it would have flowed; consumes no flow height.
          page.drawImage(embedded, freeContent);
        } else if (embedded) {
          const requestedWidth = typeof block.attrs?.width === "number" && block.attrs.width > 0 ? block.attrs.width : embedded.width;
          const requestedHeight = typeof block.attrs?.height === "number" && block.attrs.height > 0 ? block.attrs.height : embedded.height;
          const maxImageHeight = dimensions.height - dimensions.top - dimensions.bottom;
          const scale = Math.min(1, maxWidth / requestedWidth, maxImageHeight / requestedHeight);
          const width = requestedWidth * scale;
          const height = requestedHeight * scale;
          ensureSpace(height + paragraphGap);
          const imageAlign = block.attrs?.align;
          const imageX = imageAlign === "center" ? dimensions.left + (maxWidth - width) / 2 : imageAlign === "right" ? dimensions.width - dimensions.right - width : dimensions.left;
          page.drawImage(embedded, { x: imageX, y: y - height, width, height });
          y -= height + paragraphGap;
        } else {
          drawWrapped(nodeText(block, options), regular, bodySize, paragraphGap);
        }
        continue;
      }
      if (block.type === "pageBreak") {
        newPage();
        continue;
      }
      if (block.type === "table") {
        const grid = buildTableGrid(block, cell => nodeText(cell));
        if (!grid.cells.length) { y -= paragraphGap; continue; }
        const columns = grid.columns;
        // columnWidths are relative weights (e.g. [2, 1, 1]); absent/invalid values use equal columns.
        const rawWidths = block.attrs?.columnWidths;
        const weights = Array.isArray(rawWidths) && rawWidths.length >= columns
          ? Array.from({ length: columns }, (_, i) => typeof rawWidths[i] === "number" && Number.isFinite(rawWidths[i]) && rawWidths[i] > 0 ? rawWidths[i] as number : 1)
          : Array.from({ length: columns }, () => 1);
        const totalWeight = weights.reduce((sum, value) => sum + value, 0);
        const widths = weights.map(value => maxWidth * value / totalWeight);
        const starts = widths.map((_, i) => dimensions.left + widths.slice(0, i).reduce((sum, value) => sum + value, 0));
        const padding = 4;
        const cellWidth = (cell: GridCell) => widths.slice(cell.col, cell.col + cell.colspan).reduce((sum, value) => sum + value, 0);
        const wrappedByCell = new Map<GridCell, string[]>(grid.cells.map(cell => [cell, wrapText(cell.text, regular, bodySize, Math.max(10, cellWidth(cell) - padding * 2), Boolean(options.fontBytes))]));
        const rowHeights = computeRowHeights(grid, cell => (wrappedByCell.get(cell)?.length ?? 1) * lineHeight + padding * 2, bodySize * 1.5 + padding * 2);
        const heightOf = (from: number, to: number) => rowHeights.slice(from, to + 1).reduce((sum, value) => sum + value, 0);
        const groups = rowGroups(grid);
        const drawGroup = ([first, last]: [number, number]) => {
          const covered = new Set<string>();
          for (const cell of grid.cells) {
            for (let r = 0; r < cell.rowspan; r += 1) for (let c = 0; c < cell.colspan; c += 1) covered.add(`${cell.row + r}:${cell.col + c}`);
            if (cell.row < first || cell.row > last) continue;
            const x = starts[cell.col]!;
            const height = heightOf(cell.row, cell.row + cell.rowspan - 1);
            const top = y - heightOf(first, cell.row - 1);
            page.drawRectangle({ x, y: top - height, width: cellWidth(cell), height, borderColor: rgb(0.45, 0.45, 0.45), borderWidth: 0.5 });
            let textY = top - padding - bodySize;
            for (const line of wrappedByCell.get(cell) ?? []) {
              page.drawText(line, { x: x + padding, y: textY, size: bodySize, font: regular, color: rgb(0, 0, 0) });
              textY -= lineHeight;
            }
          }
          // Grid slots no cell covers (ragged rows) are still drawn as empty bordered cells.
          for (let r = first; r <= last; r += 1) for (let c = 0; c < columns; c += 1) {
            if (covered.has(`${r}:${c}`)) continue;
            page.drawRectangle({ x: starts[c]!, y: y - heightOf(first, r), width: widths[c]!, height: rowHeights[r]!, borderColor: rgb(0.45, 0.45, 0.45), borderWidth: 0.5 });
          }
          y -= heightOf(first, last);
        };
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          const group = groups[groupIndex]!;
          const groupHeight = heightOf(group[0], group[1]);
          const availableHeight = y - dimensions.bottom;
          const repeatedHeaderHeight = groupIndex > 0 ? heightOf(groups[0]![0], groups[0]![1]) : 0;
          if (groupHeight > dimensions.height - dimensions.top - dimensions.bottom) {
            // Oversized row groups, including merged rowspan cells, split into bordered continuation fragments.
            const groupCells = grid.cells.filter(cell => cell.row >= group[0] && cell.row <= group[1]);
            const maxLines = Math.max(1, ...groupCells.map(cell => wrappedByCell.get(cell)?.length ?? 1));
            const linesPerPage = Math.max(1, Math.floor((dimensions.height - dimensions.top - dimensions.bottom - padding * 2) / lineHeight));
            let lineStart = 0;
            while (lineStart < maxLines) {
              if (y - (Math.min(linesPerPage, maxLines - lineStart) * lineHeight + padding * 2) < dimensions.bottom) newPage();
              const lineEnd = Math.min(maxLines, lineStart + linesPerPage);
              const fragmentHeight = (lineEnd - lineStart) * lineHeight + padding * 2;
              for (const cell of groupCells) {
                const x = starts[cell.col]!;
                page.drawRectangle({ x, y: y - fragmentHeight, width: cellWidth(cell), height: fragmentHeight, borderColor: rgb(0.45, 0.45, 0.45), borderWidth: 0.5 });
                let textY = y - padding - bodySize;
                const cellLines = wrappedByCell.get(cell) ?? [];
                for (const line of cellLines.slice(lineStart, lineEnd)) {
                  page.drawText(line, { x: x + padding, y: textY, size: bodySize, font: regular, color: rgb(0, 0, 0) });
                  textY -= lineHeight;
                }
              }
              y -= fragmentHeight;
              lineStart = lineEnd;
              if (lineStart < maxLines) newPage();
            }
            continue;
          }
          if (groupIndex > 0 && groupHeight + repeatedHeaderHeight > availableHeight) {
            newPage();
            // Repeat the first row group as a header when a table continues on another page.
            drawGroup(groups[0]!);
          } else if (groupIndex === 0 && groupHeight > availableHeight) {
            newPage();
          }
          drawGroup(group);
        }
        y -= paragraphGap;
        continue;
      }
      const text = nodeText(block, options);
      if ((block.type === "paragraph" || block.type === "heading") && (block.content ?? []).some(item => item.type === "text" && Array.isArray((item as { marks?: unknown }).marks) && ((item as { marks: unknown[] }).marks.length > 0))) {
        const level = typeof block.attrs?.level === "number" ? block.attrs.level : 1;
        const richSize = block.type === "heading" ? Math.max(bodySize, (options.profile?.headingSizesPt ?? OFFICIAL_DOCUMENT_PROFILE.headingSizesPt)[Math.min(2, Math.max(0, level - 1))]!) : bodySize;
        drawRichBlock(block, richSize, block.type === "heading" ? bold : regular);
        continue;
      }
      if (block.type === "horizontalRule") {
        ensureSpace(8);
        page.drawLine({ start: { x: dimensions.left, y }, end: { x: dimensions.width - dimensions.right, y }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
        y -= 8;
        continue;
      }
      const headingLevel = block.type === "heading" && typeof block.attrs?.level === "number" ? block.attrs.level : 0;
      const size = headingLevel ? Math.max(bodySize, 20 - Math.min(6, headingLevel) * 1.5) : bodySize;
      const font = headingLevel ? bold : regular;
      const prefix = block.type === "bulletList" ? "â€¢ " : block.type === "orderedList" ? "1. " : "";
      drawWrapped(prefix + text, font, size, paragraphGap, block.attrs?.align ?? block.attrs?.alignment);
    }
  }

  const totalPages = pageLayouts.length;
  for (const [index, { page, dimensions, section }] of pageLayouts.entries()) {
    const pageNumber = index + 1;
    const replaceTokens = (value: string) => value.replace(/\{\{\s*pageNumber\s*\}\}/gi, String(pageNumber)).replace(/\{\{\s*pageCount\s*\}\}/gi, String(totalPages));
    const drawMarginText = (value: string, y: number) => {
      const text = safePdfText(replaceTokens(value), Boolean(options.fontBytes));
      const maxWidth = dimensions.width - dimensions.left - dimensions.right;
      let display = text;
      while (display.length > 0 && regular.widthOfTextAtSize(display, 9) > maxWidth) display = display.slice(0, -1);
      page.drawText(display, { x: dimensions.left, y, size: 9, font: regular, color: rgb(0, 0, 0) });
    };
    const drawRegion = async (blocks: readonly BlockNode[] | undefined, region: "header" | "footer") => {
      if (!blocks?.length) return;
      const contentWidth = dimensions.width - dimensions.left - dimensions.right;
      let offset = 0;
      for (const block of blocks) {
        if (region === "header" && block.type === "table") {
          const row = block.content?.find(child => "id" in child && child.type === "tableRow") as BlockNode | undefined;
          const cells = (row?.content ?? []).filter((child): child is BlockNode => "id" in child && child.type === "tableCell");
          if (!cells.length) continue;
          const widthWeights = cells.map(cell => typeof cell.attrs?.width === "number" && cell.attrs.width > 0 ? cell.attrs.width : 1);
          const weightTotal = widthWeights.reduce((sum, value) => sum + value, 0);
          const top = dimensions.height - Math.max(12, twipsToPoints(section.page.margins.header, 36)) - offset;
          let tableHeight = 0;
          for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
            const cell = cells[cellIndex]!;
            const cellWidth = contentWidth * widthWeights[cellIndex]! / weightTotal;
            const x = dimensions.left + contentWidth * widthWeights.slice(0, cellIndex).reduce((sum, value) => sum + value, 0) / weightTotal;
            let cellOffset = 0;
            for (const cellBlock of cell.content ?? []) {
              if (!("id" in cellBlock)) continue;
              const item = cellBlock as BlockNode;
              if (item.type === "image") {
                const source = item.attrs?.src;
                if (typeof source !== "string" || !options.resolveImage) continue;
                try {
                  const resolved = await options.resolveImage(source);
                  const embedded = resolved.type === "png" ? await pdf.embedPng(resolved.data) : await pdf.embedJpg(resolved.data);
                  const requestedWidth = typeof item.attrs?.width === "number" && item.attrs.width > 0 ? item.attrs.width * PX_TO_PT : embedded.width;
                  const requestedHeight = typeof item.attrs?.height === "number" && item.attrs.height > 0 ? item.attrs.height * PX_TO_PT : embedded.height;
                  const scale = Math.min(1, (cellWidth - 8) / requestedWidth, 62 / requestedHeight);
                  const width = requestedWidth * scale;
                  const height = requestedHeight * scale;
                  page.drawImage(embedded, { x: x + Math.max(4, (cellWidth - width) / 2), y: top - height - cellOffset, width, height });
                  cellOffset += height + 2;
                } catch { /* An unavailable logo should not prevent the remaining letterhead from exporting. */ }
                continue;
              }
              if (item.type === "horizontalRule") continue;
              const text = safePdfText(nodeText(item, options), Boolean(options.fontBytes));
              if (!text) continue;
              const role = item.attrs?.templateRole;
              const emphasis = role === "letterhead";
              const size = emphasis ? Math.min(14, bodySize + 2) : role === "letterheadContact" ? Math.max(8, bodySize - 3) : Math.max(9, bodySize - 1);
              const font = emphasis ? bold : regular;
              const lines = wrapText(text, font, size, cellWidth - 8, Boolean(options.fontBytes));
              for (const line of lines) {
                const lineWidth = font.widthOfTextAtSize(line, size);
                const align = item.attrs?.align;
                const textX = align === "right" ? x + cellWidth - lineWidth - 4 : align === "left" ? x + 4 : x + Math.max(4, (cellWidth - lineWidth) / 2);
                page.drawText(line, { x: textX, y: top - cellOffset - size, size, font, color: rgb(0, 0, 0) });
                cellOffset += size * 1.2;
              }
            }
            tableHeight = Math.max(tableHeight, cellOffset);
          }
          const ruleY = top - tableHeight - 2;
          page.drawLine({ start: { x: dimensions.left, y: ruleY }, end: { x: dimensions.width - dimensions.right, y: ruleY }, thickness: 0.7, color: rgb(0.2, 0.2, 0.2) });
          offset += tableHeight + 8;
          continue;
        }
        if (block.type === "horizontalRule") {
          const y = region === "header" ? dimensions.height - Math.max(12, twipsToPoints(section.page.margins.header, 36)) - offset : Math.max(8, dimensions.bottom * 0.35) + offset;
          page.drawLine({ start: { x: dimensions.left, y }, end: { x: dimensions.width - dimensions.right, y }, thickness: 0.7, color: rgb(0.2, 0.2, 0.2) });
          offset += 5;
          continue;
        }
        if (block.type === "image") {
          const source = block.attrs?.src;
          if (typeof source !== "string" || !options.resolveImage) continue;
          try {
            const resolved = await options.resolveImage(source);
            const embedded = resolved.type === "png" ? await pdf.embedPng(resolved.data) : await pdf.embedJpg(resolved.data);
            const free = freeImageRect(block.attrs, embedded, dimensions);
            if (free) { page.drawImage(embedded, free); continue; }
            const requestedWidth = typeof block.attrs?.width === "number" && block.attrs.width > 0 ? block.attrs.width : embedded.width;
            const requestedHeight = typeof block.attrs?.height === "number" && block.attrs.height > 0 ? block.attrs.height : embedded.height;
            const scale = Math.min(1, contentWidth / requestedWidth, 100 / requestedHeight);
            const width = requestedWidth * scale;
            const height = requestedHeight * scale;
            const align = block.attrs?.align;
            const x = align === "right" ? dimensions.width - dimensions.right - width : align === "center" ? dimensions.left + (contentWidth - width) / 2 : dimensions.left;
            const y = region === "header" ? dimensions.height - Math.max(12, twipsToPoints(section.page.margins.header, 36)) - height - offset : Math.max(8, dimensions.bottom * 0.35) + offset;
            page.drawImage(embedded, { x, y, width, height });
            offset += height + 2;
          } catch { /* Unresolvable image sources are skipped rather than breaking export. */ }
        } else {
          const text = safePdfText(replaceTokens(nodeText(block, options)), Boolean(options.fontBytes));
          if (text) {
            const y = region === "header" ? dimensions.height - Math.max(18, dimensions.top * 0.55) - offset : Math.max(8, dimensions.bottom * 0.35) + offset;
            page.drawText(text.slice(0, 180), { x: dimensions.left, y, size: 9, font: regular, color: rgb(0, 0, 0) });
            offset += 11;
          }
        }
      }
    };
    // First-page and even-page variants (Word "different first page" / "odd & even") pick the regions for this page.
    const regions = resolveSectionHeaderFooter(section, { pageNumber, isFirstPageOfSection: index === 0 || pageLayouts[index - 1]!.section !== section });
    await drawRegion(regions.header, "header");
    await drawRegion(regions.footer, "footer");
    if (options.header) drawMarginText(options.header, dimensions.height - Math.max(18, dimensions.top * 0.55));
    if (options.footer) drawMarginText(options.footer, Math.max(8, dimensions.bottom * 0.35));
    else if (options.pageNumbering) drawMarginText("Page {{pageNumber}} of {{pageCount}}", Math.max(8, dimensions.bottom * 0.35));
  }
  return pdf.save();
}
