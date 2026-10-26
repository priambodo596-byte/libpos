import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { BlockNode, DocumentJSON, PageSetup, Section } from "@convetlib/core";

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
}

function twipsToPoints(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value / 20 : fallback;
}

function safePdfText(value: string, unicode = false): string {
  // Standard PDF fonts use WinAnsi; custom embedded fonts can represent broader Unicode.
  return unicode ? value : value.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
}

function nodeText(node: BlockNode): string {
  if (node.type === "image") {
    const alt = node.attrs?.alt;
    return "[Image" + (typeof alt === "string" ? ": " + alt : "") + "]";
  }
  return (node.content ?? []).map(child => {
    if (child.type === "text") return (child as { text: string }).text;
    if ("id" in child) return nodeText(child as BlockNode);
    if (child.type === "placeholder") {
      const attrs = (child as { attrs?: Record<string, unknown> }).attrs;
      return "{{ " + (typeof attrs?.key === "string" ? attrs.key : "unknown") + " }}";
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

function tableRows(node: BlockNode): string[][] {
  const rows: string[][] = [];
  for (const row of node.content ?? []) {
    if (!("id" in row) || row.type !== "tableRow") continue;
    const cells: string[] = [];
    for (const cell of row.content ?? []) {
      if (!("id" in cell) || cell.type !== "tableCell") continue;
      cells.push(nodeText(cell as BlockNode));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
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
 * Export a document to PDF using standard Helvetica fonts.
 * This is a semantic text-first renderer; it does not promise HTML/CSS pixel parity.
 */
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
    bold = options.boldFontBytes ? await pdf.embedFont(options.boldFontBytes, { subset: true }) : await pdf.embedFont(StandardFonts.HelveticaBold);
    italic = options.italicFontBytes ? await pdf.embedFont(options.italicFontBytes, { subset: true }) : await pdf.embedFont(StandardFonts.HelveticaOblique);
    boldItalic = options.boldItalicFontBytes ? await pdf.embedFont(options.boldItalicFontBytes, { subset: true }) : await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  } else {
    regular = await pdf.embedFont(StandardFonts.Helvetica);
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
    boldItalic = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  }
  const bodySize = Math.max(6, Math.min(36, options.fontSize ?? 11));
  const paragraphGap = Math.max(0, Math.min(48, options.paragraphGap ?? 5));
  const pageLayouts: Array<{ page: PDFPage; dimensions: ReturnType<typeof pageDimensions>; section: Section }> = [];

  for (const section of document.sections) {
    const dimensions = pageDimensions(section.page);
    let page: PDFPage = pdf.addPage([dimensions.width, dimensions.height]);
    pageLayouts.push({ page, dimensions, section });
    let y = dimensions.height - dimensions.top;
    const maxWidth = dimensions.width - dimensions.left - dimensions.right;
    const lineHeight = bodySize * 1.35;

    const newPage = (setup: PageSetup = section.page) => {
      const d = pageDimensions(setup);
      page = pdf.addPage([d.width, d.height]);
      pageLayouts.push({ page, dimensions: d, section });
      y = d.height - d.top;
    };
    const ensureSpace = (height: number) => {
      if (y - height < dimensions.bottom) newPage();
    };
    const drawWrapped = (text: string, font: PDFFont, size: number, gapAfter = 0) => {
      const lines = wrapText(text, font, size, maxWidth, Boolean(options.fontBytes));
      for (const line of lines) {
        ensureSpace(size * 1.35);
        page.drawText(line, { x: dimensions.left, y: y - size, size, font, color: rgb(0, 0, 0) });
        y -= size * 1.35;
      }
      y -= gapAfter;
    };

    const drawRichBlock = (block: BlockNode, baseSize: number, defaultFont: PDFFont) => {
      const inline = block.content ?? [];
      const runs = inline.map(item => {
        if (item.type === "text") {
          const textNode = item as { text: string; marks?: Array<{ type: string }> };
          const marks = textNode.marks ?? [];
          const isBold = marks.some(mark => mark.type === "bold");
          const isItalic = marks.some(mark => mark.type === "italic");
          const font = isBold && isItalic ? boldItalic : isBold ? bold : isItalic ? italic : defaultFont;
          return { text: textNode.text, font, underline: marks.some(mark => mark.type === "underline"), strike: marks.some(mark => mark.type === "strike") };
        }
        if (item.type === "hardBreak") return { text: "\n", font: defaultFont, underline: false, strike: false };
        if (item.type === "placeholder") {
          const attrs = (item as { attrs?: Record<string, unknown> }).attrs;
          return { text: "{{ " + (typeof attrs?.key === "string" ? attrs.key : "unknown") + " }}", font: defaultFont, underline: false, strike: false };
        }
        return { text: "", font: defaultFont, underline: false, strike: false };
      }).filter(run => run.text.length > 0);
      const tokens = runs.flatMap(run => (run.text.match(/\s+|[^\s]+/gu) ?? []).map(text => ({ ...run, text })));
      let line = [] as typeof tokens;
      const widthOf = (parts: typeof tokens) => parts.reduce((sum, part) => sum + part.font.widthOfTextAtSize(part.text, baseSize), 0);
      const drawLine = () => {
        if (!line.length) { y -= baseSize * 1.35; return; }
        ensureSpace(baseSize * 1.5);
        let x = dimensions.left;
        const lineY = y - baseSize;
        for (const part of line) {
          const clean = safePdfText(part.text, Boolean(options.fontBytes));
          const width = part.font.widthOfTextAtSize(clean, baseSize);
          page.drawText(clean, { x, y: lineY, size: baseSize, font: part.font, color: rgb(0, 0, 0) });
          if (part.underline) page.drawLine({ start: { x, y: lineY - 1 }, end: { x: x + width, y: lineY - 1 }, thickness: 0.5, color: rgb(0, 0, 0) });
          if (part.strike) page.drawLine({ start: { x, y: lineY + baseSize * 0.35 }, end: { x: x + width, y: lineY + baseSize * 0.35 }, thickness: 0.5, color: rgb(0, 0, 0) });
          x += width;
        }
        y -= baseSize * 1.35;
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

    for (const block of section.content) {
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
        if (embedded) {
          const requestedWidth = typeof block.attrs?.width === "number" && block.attrs.width > 0 ? block.attrs.width : embedded.width;
          const requestedHeight = typeof block.attrs?.height === "number" && block.attrs.height > 0 ? block.attrs.height : embedded.height;
          const maxImageHeight = dimensions.height - dimensions.top - dimensions.bottom;
          const scale = Math.min(1, maxWidth / requestedWidth, maxImageHeight / requestedHeight);
          const width = requestedWidth * scale;
          const height = requestedHeight * scale;
          ensureSpace(height + paragraphGap);
          page.drawImage(embedded, { x: dimensions.left, y: y - height, width, height });
          y -= height + paragraphGap;
        } else {
          drawWrapped(nodeText(block), regular, bodySize, paragraphGap);
        }
        continue;
      }
      if (block.type === "pageBreak") {
        newPage();
        continue;
      }
      if (block.type === "table") {
        const rows = tableRows(block);
        if (!rows.length) { y -= paragraphGap; continue; }
        const columns = Math.max(...rows.map(row => row.length));
        // columnWidths are relative weights (e.g. [2, 1, 1]); absent/invalid values use equal columns.
        const rawWidths = block.attrs?.columnWidths;
        const weights = Array.isArray(rawWidths) && rawWidths.length >= columns
          ? Array.from({ length: columns }, (_, i) => typeof rawWidths[i] === "number" && Number.isFinite(rawWidths[i]) && rawWidths[i] > 0 ? rawWidths[i] as number : 1)
          : Array.from({ length: columns }, () => 1);
        const totalWeight = weights.reduce((sum, value) => sum + value, 0);
        const widths = weights.map(value => maxWidth * value / totalWeight);
        const starts = widths.map((_, i) => dimensions.left + widths.slice(0, i).reduce((sum, value) => sum + value, 0));
        const padding = 4;
        const rowLayouts = rows.map(row => {
          const cells = Array.from({ length: columns }, (_, i) => row[i] ?? "");
          const wrapped = cells.map((value, i) => wrapText(value, regular, bodySize, Math.max(10, widths[i]! - padding * 2), Boolean(options.fontBytes)));
          const height = Math.max(bodySize * 1.5, ...wrapped.map(lines => lines.length * lineHeight)) + padding * 2;
          return { wrapped, height };
        });
        const drawRow = (layout: typeof rowLayouts[number]) => {
          for (let i = 0; i < columns; i += 1) {
            const x = starts[i]!;
            const width = widths[i]!;
            page.drawRectangle({ x, y: y - layout.height, width, height: layout.height, borderColor: rgb(0.45, 0.45, 0.45), borderWidth: 0.5 });
            let textY = y - padding - bodySize;
            for (const line of layout.wrapped[i] ?? []) {
              page.drawText(line, { x: x + padding, y: textY, size: bodySize, font: regular, color: rgb(0, 0, 0) });
              textY -= lineHeight;
            }
          }
          y -= layout.height;
        };
        for (let rowIndex = 0; rowIndex < rowLayouts.length; rowIndex += 1) {
          const layout = rowLayouts[rowIndex]!;
          const availableHeight = y - dimensions.bottom;
          const repeatedHeaderHeight = rowIndex > 0 ? rowLayouts[0]!.height : 0;
          if (layout.height + repeatedHeaderHeight > availableHeight && rowIndex > 0) {
            newPage();
            // Repeat the first row as a header when a table continues on another page.
            const header = rowLayouts[0]!;
            drawRow(header);
          } else if (layout.height > availableHeight && rowIndex === 0) {
            // A single exceptionally tall row cannot be split safely; render it on a fresh page once.
            newPage();
          }
          drawRow(layout);
        }
        y -= paragraphGap;
        continue;
      }
      const text = nodeText(block);
      if ((block.type === "paragraph" || block.type === "heading") && (block.content ?? []).some(item => item.type === "text" && Array.isArray((item as { marks?: unknown }).marks) && ((item as { marks: unknown[] }).marks.length > 0))) {
        const richSize = block.type === "heading" ? Math.max(bodySize, 20 - Math.min(6, typeof block.attrs?.level === "number" ? block.attrs.level : 1) * 1.5) : bodySize;
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
      drawWrapped(prefix + text, font, size, paragraphGap);
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
    const drawRegion = async (blocks: BlockNode[] | undefined, region: "header" | "footer") => {
      if (!blocks?.length) return;
      const contentWidth = dimensions.width - dimensions.left - dimensions.right;
      let offset = 0;
      for (const block of blocks) {
        if (block.type === "image") {
          const source = block.attrs?.src;
          if (typeof source !== "string" || !options.resolveImage) continue;
          try {
            const resolved = await options.resolveImage(source);
            const embedded = resolved.type === "png" ? await pdf.embedPng(resolved.data) : await pdf.embedJpg(resolved.data);
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
          const text = safePdfText(replaceTokens(nodeText(block)), Boolean(options.fontBytes));
          if (text) {
            const y = region === "header" ? dimensions.height - Math.max(18, dimensions.top * 0.55) - offset : Math.max(8, dimensions.bottom * 0.35) + offset;
            page.drawText(text.slice(0, 180), { x: dimensions.left, y, size: 9, font: regular, color: rgb(0, 0, 0) });
            offset += 11;
          }
        }
      }
    };
    await drawRegion(section.header, "header");
    await drawRegion(section.footer, "footer");
    if (options.header) drawMarginText(options.header, dimensions.height - Math.max(18, dimensions.top * 0.55));
    if (options.footer) drawMarginText(options.footer, Math.max(8, dimensions.bottom * 0.35));
    else if (options.pageNumbering) drawMarginText("Page {{pageNumber}} of {{pageCount}}", Math.max(8, dimensions.bottom * 0.35));
  }
  return pdf.save();
}
