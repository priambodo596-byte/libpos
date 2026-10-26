import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { BlockNode, DocumentJSON, PageSetup, Section } from "@convetlib/core";

export interface PdfExportOptions {
  /** Font size in points for normal body text. Defaults to 11. */
  fontSize?: number;
  /** Extra vertical gap after each paragraph, in points. Defaults to 5. */
  paragraphGap?: number;
  /** Resolve an image source to binary data. Remote URLs are never fetched implicitly. */
  resolveImage?: (source: string) => Promise<{ data: Uint8Array; type: "png" | "jpg" }> | { data: Uint8Array; type: "png" | "jpg" };
}

function twipsToPoints(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value / 20 : fallback;
}

function safePdfText(value: string): string {
  // Standard PDF fonts use WinAnsi encoding; replace unsupported glyphs until custom font embedding is added.
  return value.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
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

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const normalized = safePdfText(text).replace(/\r/g, "");
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
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bodySize = Math.max(6, Math.min(36, options.fontSize ?? 11));
  const paragraphGap = Math.max(0, Math.min(48, options.paragraphGap ?? 5));

  for (const section of document.sections) {
    const dimensions = pageDimensions(section.page);
    let page: PDFPage = pdf.addPage([dimensions.width, dimensions.height]);
    let y = dimensions.height - dimensions.top;
    const maxWidth = dimensions.width - dimensions.left - dimensions.right;
    const lineHeight = bodySize * 1.35;

    const newPage = (setup: PageSetup = section.page) => {
      const d = pageDimensions(setup);
      page = pdf.addPage([d.width, d.height]);
      y = d.height - d.top;
    };
    const ensureSpace = (height: number) => {
      if (y - height < dimensions.bottom) newPage();
    };
    const drawWrapped = (text: string, font: PDFFont, size: number, gapAfter = 0) => {
      const lines = wrapText(text, font, size, maxWidth);
      for (const line of lines) {
        ensureSpace(size * 1.35);
        page.drawText(line, { x: dimensions.left, y: y - size, size, font, color: rgb(0, 0, 0) });
        y -= size * 1.35;
      }
      y -= gapAfter;
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
        const cellWidth = maxWidth / columns;
        const padding = 4;
        for (const row of rows) {
          const cells = Array.from({ length: columns }, (_, i) => row[i] ?? "");
          const wrapped = cells.map(value => wrapText(value, regular, bodySize, Math.max(10, cellWidth - padding * 2)));
          const rowHeight = Math.max(bodySize * 1.5, ...wrapped.map(lines => lines.length * lineHeight)) + padding * 2;
          ensureSpace(rowHeight);
          for (let i = 0; i < columns; i += 1) {
            const x = dimensions.left + i * cellWidth;
            page.drawRectangle({ x, y: y - rowHeight, width: cellWidth, height: rowHeight, borderColor: rgb(0.45, 0.45, 0.45), borderWidth: 0.5 });
            let textY = y - padding - bodySize;
            for (const line of wrapped[i] ?? []) {
              page.drawText(line, { x: x + padding, y: textY, size: bodySize, font: regular, color: rgb(0, 0, 0) });
              textY -= lineHeight;
            }
          }
          y -= rowHeight;
        }
        y -= paragraphGap;
        continue;
      }
      const text = nodeText(block);
      if (block.type === "horizontalRule") {
        ensureSpace(8);
        page.drawLine({ start: { x: dimensions.left, y }, end: { x: dimensions.width - dimensions.right, y }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
        y -= 8;
        continue;
      }
      const headingLevel = block.type === "heading" && typeof block.attrs?.level === "number" ? block.attrs.level : 0;
      const size = headingLevel ? Math.max(bodySize, 20 - Math.min(6, headingLevel) * 1.5) : bodySize;
      const font = headingLevel ? bold : regular;
      const prefix = block.type === "bulletList" ? "• " : block.type === "orderedList" ? "1. " : "";
      drawWrapped(prefix + text, font, size, paragraphGap);
    }
  }
  return pdf.save();
}
