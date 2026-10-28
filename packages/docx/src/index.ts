import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  ShadingType,
  VerticalAlign,
  HeadingLevel,
  Header,
  Footer,
  ImageRun,
  HorizontalPositionRelativeFrom,
  VerticalPositionRelativeFrom,
  TextWrappingType,
  PageBreak,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import { sectionUsesEvenPageVariant, sectionUsesFirstPageVariant, type BlockNode, type DocumentJSON, type Inline, type PageSetup } from "@convetlib/core";

export interface DocxExportOptions {
  /** Resolve an image source to bytes. Remote fetching is deliberately delegated to the host. */
  resolveImage?: (source: string) => Promise<{ data: Uint8Array; type: "png" | "jpg" | "gif" | "bmp" }>;
  /** Default fallback label used when an image cannot be resolved. */
  imageFallback?: (node: BlockNode) => string;
}

function stringAttr(node: BlockNode, key: string): string | undefined {
  const value = node.attrs?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberAttr(node: BlockNode, key: string): number | undefined {
  const value = node.attrs?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textRuns(inline: readonly Inline[]): TextRun[] {
  const runs: TextRun[] = [];
  for (const node of inline) {
    if (node.type === "text") {
      const value = node as { type: "text"; text: string; marks?: Array<{ type: string }> };
      const marks = new Set((value.marks ?? []).map(mark => mark.type));
      const options: IRunOptions = {
        text: value.text,
        bold: marks.has("bold"),
        italics: marks.has("italic"),
        strike: marks.has("strike"),
        ...(marks.has("underline") ? { underline: {} } : {}),
        superScript: marks.has("superscript"),
        subScript: marks.has("subscript"),
      };
      runs.push(new TextRun(options));
    } else if (node.type === "hardBreak") {
      runs.push(new TextRun({ text: "", break: 1 }));
    } else if (node.type === "placeholder") {
      const attrs = (node as { attrs?: Record<string, unknown> }).attrs;
      const key = typeof attrs?.key === "string" ? attrs.key : "unknown";
      runs.push(new TextRun({ text: "{{ " + key + " }}" }));
    } else if (node.type === "pageNumber") {
      runs.push(new TextRun({ text: "{{ pageNumber }}" }));
    } else if (node.type === "pageCount") {
      runs.push(new TextRun({ text: "{{ pageCount }}" }));
    }
  }
  return runs;
}

function paragraphChildren(node: BlockNode): ParagraphChild[] {
  const content = (node.content ?? []).filter((child): child is Inline => child.type === "text" || child.type === "hardBreak" || child.type === "placeholder" || child.type === "pageNumber" || child.type === "pageCount");
  return textRuns(content);
}

function alignment(node: BlockNode): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const value = node.attrs?.align ?? node.attrs?.alignment;
  if (value === "left") return AlignmentType.LEFT;
  if (value === "center") return AlignmentType.CENTER;
  if (value === "right") return AlignmentType.RIGHT;
  if (value === "justify") return AlignmentType.JUSTIFIED;
  return undefined;
}

function paragraph(node: BlockNode): Paragraph {
  const align = alignment(node);
  const level = numberAttr(node, "level") ?? 1;
  const heading = level <= 1 ? HeadingLevel.HEADING_1
    : level === 2 ? HeadingLevel.HEADING_2
    : level === 3 ? HeadingLevel.HEADING_3
    : level === 4 ? HeadingLevel.HEADING_4
    : level === 5 ? HeadingLevel.HEADING_5 : HeadingLevel.HEADING_6;
  const spacingBefore = numberAttr(node, "spacingBefore");
  const spacingAfter = numberAttr(node, "spacingAfter");
  const indentLeft = numberAttr(node, "indentLeft");
  const indentRight = numberAttr(node, "indentRight");
  const firstLineIndent = numberAttr(node, "firstLineIndent");
  const lineSpacing = numberAttr(node, "lineSpacing");
  const options = {
    children: paragraphChildren(node),
    ...(align ? { alignment: align } : {}),
    ...(node.type === "heading" ? { heading } : {}),
    ...(node.type === "codeBlock" ? { style: "No Spacing" } : {}),
    ...(node.type === "listItem" ? { bullet: { level: 0 } } : {}),
    ...((spacingBefore !== undefined || spacingAfter !== undefined || lineSpacing !== undefined) ? { spacing: {
      ...(spacingBefore !== undefined && spacingBefore >= 0 ? { before: Math.round(spacingBefore) } : {}),
      ...(spacingAfter !== undefined && spacingAfter >= 0 ? { after: Math.round(spacingAfter) } : {}),
      ...(lineSpacing !== undefined && lineSpacing > 0 ? { line: Math.round(lineSpacing), lineRule: "exact" as const } : {}),
    } } : {}),
    ...((indentLeft !== undefined || indentRight !== undefined || firstLineIndent !== undefined) ? { indent: {
      ...(indentLeft !== undefined && indentLeft >= 0 ? { left: Math.round(indentLeft) } : {}),
      ...(indentRight !== undefined && indentRight >= 0 ? { right: Math.round(indentRight) } : {}),
      ...(firstLineIndent !== undefined ? { firstLine: Math.round(firstLineIndent) } : {}),
    } } : {}),
  };
  return new Paragraph(options);
}

function twips(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

function pageProperties(page: PageSetup) {
  return {
    size: {
      width: twips(page.size.width, 11906),
      height: twips(page.size.height, 16838),
      orientation: page.orientation,
    },
    margin: {
      top: twips(page.margins.top, 1440),
      right: twips(page.margins.right, 1440),
      bottom: twips(page.margins.bottom, 1440),
      left: twips(page.margins.left, 1440),
      header: twips(page.margins.header, 720),
      footer: twips(page.margins.footer, 720),
    },
  };
}

function plainText(node: BlockNode): string {
  if (node.type === "text") return (node as unknown as { text: string }).text;
  return (node.content ?? []).map(child => child.type === "text"
    ? (child as unknown as { text: string }).text
    : "id" in child ? plainText(child as BlockNode) : "").join("");
}

const BORDER_STYLES: Record<string, (typeof BorderStyle)[keyof typeof BorderStyle]> = { solid: BorderStyle.SINGLE, dashed: BorderStyle.DASHED, dotted: BorderStyle.DOTTED, double: BorderStyle.DOUBLE };
/** Parses a model border (`none` or `<px>px <solid|dashed|dotted|double> #rrggbb`) into OOXML border options; malformed values yield undefined. */
function cellBorder(value: unknown): { style: (typeof BorderStyle)[keyof typeof BorderStyle]; size: number; color: string } | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text === "none") return { style: BorderStyle.NONE, size: 0, color: "auto" };
  const m = /^(\d+(?:\.\d+)?)px\s+(solid|dashed|dotted|double)\s+#([0-9a-f]{6})$/i.exec(text);
  if (!m) return undefined;
  const px = Number(m[1]);
  if (!Number.isFinite(px) || px <= 0) return undefined;
  // OOXML sz is in eighths of a point (1px = 6 units); 2..96 is the valid range.
  return { style: BORDER_STYLES[m[2]!.toLowerCase()]!, size: Math.max(2, Math.min(96, Math.round(px * 6))), color: m[3]! };
}
/** Builds the DOCX cell property options for the model attributes that DOCX can represent. */
function cellProperties(cell: BlockNode): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  const width = numberAttr(cell, "width");
  if (width !== undefined && Number.isFinite(width) && width > 0) options.width = { size: Math.round(width), type: WidthType.DXA };
  const fill = stringAttr(cell, "backgroundColor");
  if (fill && /^#[0-9a-f]{6}$/i.test(fill)) options.shading = { type: ShadingType.CLEAR, fill: fill.slice(1), color: "auto" };
  const align = stringAttr(cell, "verticalAlign");
  if (align === "top") options.verticalAlign = VerticalAlign.TOP;
  else if (align === "center") options.verticalAlign = VerticalAlign.CENTER;
  else if (align === "bottom") options.verticalAlign = VerticalAlign.BOTTOM;
  const borders: Record<string, unknown> = {};
  for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
    const border = cellBorder(cell.attrs?.["border" + side]);
    if (border) borders[side.toLowerCase()] = border;
  }
  if (Object.keys(borders).length) options.borders = borders;
  return options;
}

const MAX_TABLE_SPAN = 100;
/** Coerces a colspan/rowspan model value to an integer in [1, max]; anything invalid becomes 1. */
function boundedSpan(value: unknown, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, max));
}

async function blockToParagraphs(node: BlockNode, options: DocxExportOptions): Promise<Array<Paragraph | Table>> {
  if (node.type === "pageBreak") return [new Paragraph({ children: [new PageBreak()] })];
  if (node.type === "table") {
    const rows: TableRow[] = [];
    const rowNodes = (node.content ?? []).filter((c): c is BlockNode => "id" in c && c.type === "tableRow");
    // Columns already taken by a rowSpan from an earlier row, keyed by row index. The model stores no continuation cells.
    const occupied: Array<Set<number>> = rowNodes.map(() => new Set<number>());
    let totalColumns = 0;
    const knownWidths = new Map<number, number>();
    rowNodes.forEach((rowNode, rowIndex) => {
      const cells: TableCell[] = [];
      let column = 0;
      for (const cellChild of rowNode.content ?? []) {
        if (!("id" in cellChild) || cellChild.type !== "tableCell") continue;
        const cellNode = cellChild as BlockNode;
        while (occupied[rowIndex]!.has(column)) column += 1;
        const columnSpan = boundedSpan(cellNode.attrs?.colspan, MAX_TABLE_SPAN);
        const rowSpan = boundedSpan(cellNode.attrs?.rowspan, rowNodes.length - rowIndex);
        for (let r = 1; r < rowSpan; r += 1) for (let c = 0; c < columnSpan; c += 1) occupied[rowIndex + r]!.add(column + c);
        const properties = cellProperties(cellNode);
        if (columnSpan === 1 && properties.width && !knownWidths.has(column)) knownWidths.set(column, (properties.width as { size: number }).size);
        column += columnSpan;
        totalColumns = Math.max(totalColumns, column);
        const paragraphs: Paragraph[] = [];
        for (const child of cellNode.content ?? []) {
          if (!("id" in child)) continue;
          const cellBlock = child as BlockNode;
          if (cellBlock.type === "paragraph" || cellBlock.type === "heading" || cellBlock.type === "codeBlock") paragraphs.push(paragraph(cellBlock));
          else if (cellBlock.type === "image") paragraphs.push(new Paragraph({ text: options.imageFallback?.(cellBlock) ?? "[Image]" }));
        }
        if (!paragraphs.length) paragraphs.push(new Paragraph({ text: plainText(cellNode) }));
        cells.push(new TableCell({ children: paragraphs, ...properties, ...(columnSpan > 1 ? { columnSpan } : {}), ...(rowSpan > 1 ? { rowSpan } : {}) }));
      }
      const rowHeight = numberAttr(rowNode, "height");
      if (cells.length) rows.push(new TableRow({ children: cells, ...(rowHeight !== undefined && rowHeight > 0 ? { height: { value: Math.round(rowHeight), rule: HeightRule.ATLEAST } } : {}) }));
    });
    if (!rows.length) return [new Paragraph({ text: "" })];
    // Rows whose cells were all skipped are dropped above, so only the columns actually used are declared.
    // Columns with an explicit cell width keep it; the others share the remaining text width (9026 twips on A4 defaults).
    const columnCount = Math.max(1, totalColumns);
    const knownTotal = [...knownWidths.values()].reduce((sum, value) => sum + value, 0);
    const unknownCount = columnCount - knownWidths.size;
    const share = unknownCount > 0 ? Math.max(300, Math.floor((9026 - knownTotal) / unknownCount)) : 0;
    const columnWidths = Array.from({ length: columnCount }, (_, index) => knownWidths.get(index) ?? share);
    return [new Table({ rows, columnWidths, width: { size: 100, type: WidthType.PERCENTAGE } })];
  }
  if (node.type === "image") {
    const src = stringAttr(node, "src");
    const alt = stringAttr(node, "alt") ?? "Image";
    if (src && options.resolveImage) {
      const image = await options.resolveImage(src);
      const width = Math.max(1, Math.min(2000, Math.round(numberAttr(node, "width") ?? 320)));
      const height = Math.max(1, Math.min(2000, Math.round(numberAttr(node, "height") ?? 180)));
      const positionX = numberAttr(node, "positionX");
      const positionY = numberAttr(node, "positionY");
      if (positionX !== undefined && positionY !== undefined && positionX >= 0 && positionY >= 0) {
        // Free-positioned image: anchored (floating) to the page. Model coordinates are CSS px (96 dpi) from the page's top-left edge; 1 px = 9525 EMU.
        return [new Paragraph({
          children: [new ImageRun({
            data: image.data,
            type: image.type,
            transformation: { width, height },
            floating: {
              horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: Math.round(positionX * 9525) },
              verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: Math.round(positionY * 9525) },
              allowOverlap: true,
              behindDocument: false,
              wrap: { type: TextWrappingType.NONE },
            },
          })],
        })];
      }
      const align = alignment(node);
      return [new Paragraph({
        children: [new ImageRun({ data: image.data, type: image.type, transformation: { width, height } })],
        ...(align ? { alignment: align } : {}),
      })];
    }
    return [new Paragraph({ text: options.imageFallback?.(node) ?? "[Image: " + alt + "]" })];
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    const items: Paragraph[] = [];
    let ordinal = numberAttr(node, "start") ?? 1;
    for (const child of node.content ?? []) {
      if (!("id" in child) || child.type !== "listItem") continue;
      const item = child as BlockNode;
      const text = plainText(item);
      items.push(new Paragraph({ children: [new TextRun({ text: node.type === "orderedList" ? String(ordinal++) + ". " + text : "• " + text })] }));
    }
    return items.length ? items : [new Paragraph({ text: "" })];
  }
  if (node.type === "horizontalRule") return [paragraph(node)];
  if (node.type === "paragraph" || node.type === "heading" || node.type === "codeBlock" || node.type === "blockquote" || node.type === "listItem") {
    return [paragraph(node)];
  }
  return [new Paragraph({ text: plainText(node) })];
}

/**
 * Export the current document model to a DOCX byte array.
 * This is a semantic export, not a pixel-perfect HTML/CSS conversion.
 */
export async function exportDocx(document: DocumentJSON, options: DocxExportOptions = {}): Promise<Uint8Array> {
  if (!document || !Array.isArray(document.sections) || document.sections.length === 0) {
    throw new TypeError("A document with at least one section is required");
  }
  const sections = [];
  let anyEvenVariant = false;
  for (const section of document.sections) {
    const children: Array<Paragraph | Table> = [];
    for (const block of section.content) children.push(...await blockToParagraphs(block, options));
    if (!children.length) children.push(new Paragraph({ text: "" }));
    const regionChildren = async (blocks: readonly BlockNode[] | undefined) => {
      const result: Array<Paragraph | Table> = [];
      for (const block of blocks ?? []) result.push(...await blockToParagraphs(block, options));
      return result;
    };
    // A Header/Footer part needs at least one paragraph; an enabled variant with no content is a deliberately blank region.
    const variantChildren = async (blocks: readonly BlockNode[] | undefined) => {
      const children = await regionChildren(blocks);
      return children.length ? children : [new Paragraph({})];
    };
    const variantHeader = async (blocks: readonly BlockNode[] | undefined) => new Header({ children: await variantChildren(blocks) });
    const variantFooter = async (blocks: readonly BlockNode[] | undefined) => new Footer({ children: await variantChildren(blocks) });
    const headerChildren = await regionChildren(section.header);
    const footerChildren = await regionChildren(section.footer);
    const usesFirst = sectionUsesFirstPageVariant(section);
    const usesEven = sectionUsesEvenPageVariant(section);
    const headers: Record<string, Header> = {};
    const footers: Record<string, Footer> = {};
    if (headerChildren.length) headers.default = new Header({ children: headerChildren });
    if (footerChildren.length) footers.default = new Footer({ children: footerChildren });
    if (usesFirst) { headers.first = await variantHeader(section.firstPageHeader); footers.first = await variantFooter(section.firstPageFooter); }
    if (usesEven) { headers.even = await variantHeader(section.evenPageHeader); footers.even = await variantFooter(section.evenPageFooter); }
    anyEvenVariant ||= usesEven;
    sections.push({
      properties: { page: pageProperties(section.page), ...(usesFirst ? { titlePage: true } : {}) },
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(Object.keys(footers).length ? { footers } : {}),
      children,
    });
  }
  const doc = new Document({
    title: document.meta.title,
    creator: "Convetlib",
    subject: "Generated business document",
    ...(anyEvenVariant ? { evenAndOddHeaderAndFooters: true } : {}),
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24, color: "000000" },
          paragraph: { spacing: { after: 120, line: 276, lineRule: "auto" } },
        },
        heading1: { run: { font: "Times New Roman", size: 32, bold: true, color: "000000" }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } },
        heading2: { run: { font: "Times New Roman", size: 28, bold: true, color: "000000" }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true } },
        heading3: { run: { font: "Times New Roman", size: 26, bold: true, color: "000000" }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true } },
      },
    },
    sections,
  });
  // toArrayBuffer works in Node and browsers; toBuffer needs JSZip's "nodebuffer" type, which browsers do not support.
  const buffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(buffer);
}

export { importDocx } from './import';
export type { DocxImportOptions } from './import';
