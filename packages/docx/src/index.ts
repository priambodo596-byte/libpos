import {
  AlignmentType,
  Document,
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
import type { BlockNode, DocumentJSON, Inline, PageSetup } from "@convetlib/core";

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

async function blockToParagraphs(node: BlockNode, options: DocxExportOptions): Promise<Array<Paragraph | Table>> {
  if (node.type === "pageBreak") return [new Paragraph({ children: [new PageBreak()] })];
  if (node.type === "table") {
    const rows: TableRow[] = [];
    for (const rowChild of node.content ?? []) {
      if (!("id" in rowChild) || rowChild.type !== "tableRow") continue;
      const rowNode = rowChild as BlockNode;
      const cells: TableCell[] = [];
      for (const cellChild of rowNode.content ?? []) {
        if (!("id" in cellChild) || cellChild.type !== "tableCell") continue;
        const cellNode = cellChild as BlockNode;
        const paragraphs: Paragraph[] = [];
        for (const child of cellNode.content ?? []) {
          if (!("id" in child)) continue;
          const cellBlock = child as BlockNode;
          if (cellBlock.type === "paragraph" || cellBlock.type === "heading" || cellBlock.type === "codeBlock") paragraphs.push(paragraph(cellBlock));
          else if (cellBlock.type === "image") paragraphs.push(new Paragraph({ text: options.imageFallback?.(cellBlock) ?? "[Image]" }));
        }
        if (!paragraphs.length) paragraphs.push(new Paragraph({ text: plainText(cellNode) }));
        cells.push(new TableCell({ children: paragraphs }));
      }
      if (cells.length) rows.push(new TableRow({ children: cells }));
    }
    if (!rows.length) return [new Paragraph({ text: "" })];
    return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })];
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
  for (const section of document.sections) {
    const children: Array<Paragraph | Table> = [];
    for (const block of section.content) children.push(...await blockToParagraphs(block, options));
    if (!children.length) children.push(new Paragraph({ text: "" }));
    const headerChildren: Array<Paragraph | Table> = [];
    for (const block of section.header ?? []) headerChildren.push(...await blockToParagraphs(block, options));
    const footerChildren: Array<Paragraph | Table> = [];
    for (const block of section.footer ?? []) footerChildren.push(...await blockToParagraphs(block, options));
    sections.push({
      properties: { page: pageProperties(section.page) },
      ...(headerChildren.length ? { headers: { default: new Header({ children: headerChildren }) } } : {}),
      ...(footerChildren.length ? { footers: { default: new Footer({ children: footerChildren }) } } : {}),
      children,
    });
  }
  const doc = new Document({
    title: document.meta.title,
    sections,
  });
  // toArrayBuffer works in Node and browsers; toBuffer needs JSZip's "nodebuffer" type, which browsers do not support.
  const buffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(buffer);
}

export { importDocx } from './import';
export type { DocxImportOptions } from './import';
