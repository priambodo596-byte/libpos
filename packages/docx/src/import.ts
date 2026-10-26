import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { createDocument, createNodeFactory, createSequentialIdGenerator, defaultPageSetup, type BlockNode, type DocumentJSON, type Inline, type Mark, type PageSetup } from "@convetlib/core";

export interface DocxImportOptions {
  title?: string;
  /** Maximum compressed DOCX bytes accepted. Defaults to 25 MiB. */
  maxInputBytes?: number;
  /** Maximum uncompressed XML part size accepted. Defaults to 10 MiB per part. */
  maxXmlPartBytes?: number;
  /** Maximum ZIP entries accepted. Defaults to 2,000. */
  maxEntries?: number;
  /** Inject deterministic IDs for tests or host-controlled document identity. */
  ids?: () => string;
  /** ISO timestamp used for imported document metadata. */
  now?: string;
}

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DOC_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const MAX_INPUT = 25 * 1024 * 1024;
const MAX_XML_PART = 10 * 1024 * 1024;
const MAX_ENTRIES = 2000;
type XmlDocument = ReturnType<DOMParser["parseFromString"]>;

function elements(parent: Element, localName: string, namespace = WORD_NS): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const child = parent.childNodes.item(i);
    if (child?.nodeType === 1 && (child as Element).localName === localName && (child as Element).namespaceURI === namespace) result.push(child as Element);
  }
  return result;
}
function descendants(parent: Element, localName: string, namespace = WORD_NS): Element[] {
  const result: Element[] = [];
  const found = parent.getElementsByTagNameNS(namespace, localName);
  for (let i = 0; i < found.length; i += 1) result.push(found.item(i) as Element);
  return result;
}
function first(parent: Element | XmlDocument, localName: string, namespace = WORD_NS): Element | undefined {
  const found = parent.getElementsByTagNameNS(namespace, localName);
  return found.length ? found.item(0) as Element : undefined;
}
function attr(element: Element | undefined, localName: string, namespace = WORD_NS): string | undefined {
  if (!element) return undefined;
  const value = element.getAttributeNS(namespace, localName);
  return value || undefined;
}
function parseXml(xml: string, partName: string): XmlDocument {
  let parserError = "";
  const doc = new DOMParser({ onError: (_level, message) => { parserError += message; } }).parseFromString(xml, "application/xml");
  if (parserError || !doc.documentElement || doc.documentElement.localName === "parsererror") {
    throw new TypeError(`Invalid XML in DOCX part ${partName}`);
  }
  return doc;
}
function readXml(zip: JSZip, path: string, maxBytes: number): Promise<XmlDocument> {
  const file = zip.file(path);
  if (!file) return Promise.reject(new TypeError(`DOCX is missing required part: ${path}`));
  const uncompressedSize = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (uncompressedSize !== undefined && uncompressedSize > maxBytes) return Promise.reject(new RangeError(`DOCX part exceeds size limit: ${path}`));
  return file.async("string").then(xml => {
    if (new TextEncoder().encode(xml).byteLength > maxBytes) throw new RangeError(`DOCX part exceeds size limit: ${path}`);
    return parseXml(xml, path);
  });
}
function twipsValue(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}
function readPageSetup(documentXml: XmlDocument): PageSetup {
  const sect = first(documentXml, "sectPr");
  const size = sect ? first(sect, "pgSz") : undefined;
  const margins = sect ? first(sect, "pgMar") : undefined;
  const base = defaultPageSetup();
  const width = twipsValue(attr(size, "w"), base.size.width);
  const height = twipsValue(attr(size, "h"), base.size.height);
  return {
    size: { width, height },
    orientation: attr(size, "orient") === "landscape" || width > height ? "landscape" : "portrait",
    margins: {
      top: twipsValue(attr(margins, "top"), base.margins.top),
      right: twipsValue(attr(margins, "right"), base.margins.right),
      bottom: twipsValue(attr(margins, "bottom"), base.margins.bottom),
      left: twipsValue(attr(margins, "left"), base.margins.left),
      header: twipsValue(attr(margins, "header"), base.margins.header),
      footer: twipsValue(attr(margins, "footer"), base.margins.footer),
    },
  };
}
type CharacterStyle = { id: string; basedOn?: string; attrs: Record<string, boolean | string> };
type RunFormat = Record<string, boolean | string>;

function readRunFormat(props: Element | undefined): RunFormat {
  const result: RunFormat = {};
  if (!props) return result;
  const toggle = (source: string, target: string) => {
    const item = elements(props, source)[0];
    if (!item) return;
    const value = attr(item, "val");
    result[target] = value === undefined ? true : !["0", "false", "off", "none"].includes(value.toLowerCase());
  };
  toggle("b", "bold");
  toggle("i", "italic");
  toggle("u", "underline");
  toggle("strike", "strike");
  toggle("dstrike", "strike");
  const fonts = elements(props, "rFonts")[0];
  const fontFamily = attr(fonts, "ascii") ?? attr(fonts, "hAnsi") ?? attr(fonts, "eastAsia");
  if (fontFamily) result.fontFamily = fontFamily;
  const size = attr(elements(props, "sz")[0], "val");
  if (size !== undefined && Number.isFinite(Number(size)) && Number(size) > 0) result.fontSize = String(Number(size) / 2);
  const color = attr(elements(props, "color")[0], "val");
  if (color && /^[0-9a-f]{6}$/i.test(color)) result.color = "#" + color;
  const highlight = attr(elements(props, "highlight")[0], "val");
  if (highlight && !["none", "nil"].includes(highlight)) result.highlight = highlight;
  const vertical = attr(elements(props, "vertAlign")[0], "val");
  if (vertical !== undefined) result.vertical = vertical;
  return result;
}

function paragraphMarks(run: Element, paragraphStyleId?: string, characterStyles: Map<string, CharacterStyle> = new Map(), paragraphStyles: Map<string, ParagraphStyle> = new Map()): Mark[] {
  const resolved: RunFormat = {};
  const applyChain = (id: string | undefined, styles: Map<string, { id: string; basedOn?: string; attrs?: RunFormat }>) => {
    const chain: { id: string; basedOn?: string; attrs?: RunFormat }[] = [];
    const seen = new Set<string>();
    let current = id ? styles.get(id) : undefined;
    while (current && !seen.has(current.id) && chain.length < 32) {
      seen.add(current.id); chain.unshift(current);
      current = current.basedOn ? styles.get(current.basedOn) : undefined;
    }
    for (const style of chain) Object.assign(resolved, style.attrs ?? {});
  };
  applyChain(paragraphStyleId, new Map([...paragraphStyles].map(([id, style]) => [id, { id, ...(style.basedOn ? { basedOn: style.basedOn } : {}), attrs: readRunFormat(style.runProps) }])));
  const runProps = elements(run, "rPr")[0];
  const charStyleId = attr(elements(runProps ?? run, "rStyle")[0], "val");
  applyChain(charStyleId, characterStyles);
  Object.assign(resolved, readRunFormat(runProps));
  const marks: Mark[] = [];
  if (resolved.bold === true) marks.push({ type: "bold" });
  if (resolved.italic === true) marks.push({ type: "italic" });
  if (resolved.underline === true) marks.push({ type: "underline" });
  if (resolved.strike === true) marks.push({ type: "strike" });
  const textStyle: Record<string, string | number> = {};
  if (typeof resolved.fontFamily === "string") textStyle.fontFamily = resolved.fontFamily;
  if (typeof resolved.fontSize === "string" && Number.isFinite(Number(resolved.fontSize)) && Number(resolved.fontSize) > 0) textStyle.fontSize = Number(resolved.fontSize);
  if (typeof resolved.color === "string") textStyle.color = resolved.color;
  if (Object.keys(textStyle).length) marks.push({ type: "textStyle", attrs: textStyle });
  if (typeof resolved.highlight === "string") {
    const highlightColors: Record<string, string> = { yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000", darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000" };
    const color = highlightColors[resolved.highlight] ?? (/^[0-9a-f]{6}$/i.test(resolved.highlight) ? "#" + resolved.highlight : undefined);
    if (color) marks.push({ type: "highlight", attrs: { color } });
  }
  if (resolved.vertical === "superscript") marks.push({ type: "superscript" });
  if (resolved.vertical === "subscript") marks.push({ type: "subscript" });
  return marks;
}
function runContent(paragraph: Element, relationships: Map<string, { target: string; type?: string }>, media: Map<string, { data: string; mime: string }>, factory: ReturnType<typeof createNodeFactory>, paragraphStyleId?: string, characterStyles: Map<string, CharacterStyle> = new Map(), paragraphStyles: Map<string, ParagraphStyle> = new Map()): Inline[] {
  const inline: Inline[] = [];
  const process = (element: Element) => {
    if (element.namespaceURI !== WORD_NS) {
      if (element.localName === "drawing" || element.localName === "pict") {
        // The drawing is imported as a block-level image by imagesFromParagraph.
        // Do not insert a textual placeholder here, otherwise the imported paragraph
        // displays a duplicate "[Image]" label beside the actual image node.
      }
      return;
    }
    if (element.localName === "t" || element.localName === "delText") {
      const text = element.textContent ?? "";
      if (text) { const marks = element.parentElement ? paragraphMarks(element.parentElement, paragraphStyleId, characterStyles, paragraphStyles) : []; inline.push({ type: "text", text, ...(marks.length ? { marks } : {}) }); }
    } else if (element.localName === "tab") {
      inline.push({ type: "text", text: "\t" });
    } else if (element.localName === "br" || element.localName === "cr") {
      inline.push({ type: "hardBreak" });
    } else if (element.localName === "r") {
      const marks = paragraphMarks(element, paragraphStyleId, characterStyles, paragraphStyles);
      for (const child of elements(element, "t").concat(elements(element, "delText"))) {
        const text = child.textContent ?? "";
        if (text) inline.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
      }
      for (const child of elements(element, "tab")) { void child; inline.push({ type: "text", text: "\t", ...(marks.length ? { marks } : {}) }); }
      for (const child of elements(element, "br").concat(elements(element, "cr"))) { void child; inline.push({ type: "hardBreak" }); }
      // Drawing nodes are imported as editable block-level image nodes by blockFromElement.
    } else if (element.localName === "hyperlink") {
      const relationshipId = element.getAttributeNS(REL_NS, "id");
      const relationship = relationshipId ? relationships.get(relationshipId) : undefined;
      const anchor = element.getAttributeNS(WORD_NS, "anchor");
      const href = relationship?.target ?? (anchor ? "#" + anchor : undefined);
      const start = inline.length;
      for (const child of elements(element, "r")) process(child);
      if (href && /^(https?:\/\/|mailto:|#)/i.test(href)) {
        for (let index = start; index < inline.length; index += 1) {
          const item = inline[index];
          if (item && "text" in item && typeof item.text === "string") {
            const marks = item.marks ?? [];
            inline[index] = { type: "text", text: item.text, marks: [...marks, { type: "link", attrs: { href } }] };
          }
        }
      }
    }
  };
  for (let i = 0; i < paragraph.childNodes.length; i += 1) {
    const child = paragraph.childNodes.item(i);
    if (child?.nodeType === 1) process(child as Element);
  }
  return inline;
}
type ParagraphStyle = { id: string; name?: string; basedOn?: string; outlineLevel?: number; attrs: Record<string, string | number>; runProps?: Element };
async function readCharacterStyles(zip: JSZip, limit: number): Promise<Map<string, CharacterStyle>> {
  const result = new Map<string, CharacterStyle>();
  if (!zip.file("word/styles.xml")) return result;
  const xml = await readXml(zip, "word/styles.xml", limit);
  for (const style of elements(xml.documentElement as unknown as Element, "style")) {
    if (attr(style, "type") !== "character") continue;
    const id = attr(style, "styleId");
    if (!id) continue;
    const basedOn = attr(elements(style, "basedOn")[0], "val");
    result.set(id, { id, ...(basedOn ? { basedOn } : {}), attrs: readRunFormat(elements(style, "rPr")[0]) });
  }
  return result;
}

async function readParagraphStyles(zip: JSZip, limit: number): Promise<Map<string, ParagraphStyle>> {
  const result = new Map<string, ParagraphStyle>();
  if (!zip.file("word/styles.xml")) return result;
  const xml = await readXml(zip, "word/styles.xml", limit);
  for (const style of elements(xml.documentElement as unknown as Element, "style")) {
    if (attr(style, "type") !== "paragraph") continue;
    const id = attr(style, "styleId");
    if (!id) continue;
    const name = attr(elements(style, "name")[0], "val");
    const basedOn = attr(elements(style, "basedOn")[0], "val");
    const pPr = elements(style, "pPr")[0];
    const outline = attr(elements(pPr ?? style, "outlineLvl")[0], "val");
    result.set(id, { id, ...(name ? { name } : {}), ...(basedOn ? { basedOn } : {}), ...(outline !== undefined && Number.isInteger(Number(outline)) ? { outlineLevel: Number(outline) } : {}), attrs: readParagraphAttrs(pPr), ...(elements(style, "rPr")[0] ? { runProps: elements(style, "rPr")[0]! } : {}) });
  }
  return result;
}
function readParagraphAttrs(props: Element | undefined): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  if (!props) return result;
  const align = attr(elements(props, "jc")[0], "val");
  if (["left", "center", "right", "both", "distribute"].includes(align ?? "")) result.align = align === "both" || align === "distribute" ? "justify" : align!;
  const ind = elements(props, "ind")[0];
  for (const [source, target] of [["left", "indentLeft"], ["right", "indentRight"], ["firstLine", "firstLineIndent"], ["hanging", "hangingIndent"]]) {
    const value = attr(ind, source!);
    if (value !== undefined && Number.isFinite(Number(value))) result[target!] = Number(value);
  }
  const spacing = elements(props, "spacing")[0];
  for (const [source, target] of [["before", "spacingBefore"], ["after", "spacingAfter"], ["line", "lineSpacing"]]) {
    const value = attr(spacing, source!);
    if (value !== undefined && Number.isFinite(Number(value))) result[target!] = Number(value);
  }
  const rule = attr(spacing, "lineRule");
  if (rule) result.lineSpacingRule = rule;
  return result;
}
function makeParagraph(element: Element, relationships: Map<string, { target: string; type?: string }>, media: Map<string, { data: string; mime: string }>, factory: ReturnType<typeof createNodeFactory>, styles: Map<string, ParagraphStyle> = new Map(), characterStyles: Map<string, CharacterStyle> = new Map()): BlockNode {
  const props = elements(element, "pPr")[0];
  const styleId = attr(elements(props ?? element, "pStyle")[0], "val");
  const style = styleId ? styles.get(styleId) : undefined;
  const heading = styleId?.match(/^Heading([1-6])$/i);
  const level = heading ? Number(heading[1]) : style?.outlineLevel !== undefined && style.outlineLevel >= 0 && style.outlineLevel < 6 ? style.outlineLevel + 1 : undefined;
  const inline = runContent(element, relationships, media, factory, styleId, characterStyles, styles);
  const node = level ? factory.heading(level as 1 | 2 | 3 | 4 | 5 | 6, inline) : factory.paragraph(inline);
  const chain: ParagraphStyle[] = [];
  const seen = new Set<string>();
  let current = style;
  while (current && !seen.has(current.id) && chain.length < 32) {
    seen.add(current.id); chain.unshift(current);
    current = current.basedOn ? styles.get(current.basedOn) : undefined;
  }
  const inherited: Record<string, string | number> = {};
  for (const item of chain) Object.assign(inherited, item.attrs);
  Object.assign(inherited, readParagraphAttrs(props));
  if (styleId) inherited.styleId = styleId;
  if (style?.name) inherited.styleName = style.name;
  if (style?.basedOn) inherited.styleBasedOn = style.basedOn;
  node.attrs = { ...(node.attrs ?? {}), ...inherited };
  return node;
}
function imagesFromParagraph(element: Element, relationships: Map<string, { target: string; type?: string }>, media: Map<string, { data: string; mime: string }>, factory: ReturnType<typeof createNodeFactory>): BlockNode[] {
  const result: BlockNode[] = [];
  const drawings = descendants(element, "drawing");
  for (const drawing of drawings) {
    const blip = drawing.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "blip").item(0) as Element | null;
    const relationshipId = blip?.getAttributeNS(REL_NS, "embed");
    const relationship = relationshipId ? relationships.get(relationshipId) : undefined;
    const asset = relationship ? media.get(relationship.target) : undefined;
    if (!asset) continue;
    const extent = first(drawing, "extent", "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing");
    const cx = Number(extent?.getAttribute("cx"));
    const cy = Number(extent?.getAttribute("cy"));
    const width = Number.isFinite(cx) && cx > 0 ? Math.max(1, Math.min(2000, Math.round(cx / 9525))) : undefined;
    const height = Number.isFinite(cy) && cy > 0 ? Math.max(1, Math.min(2000, Math.round(cy / 9525))) : undefined;
    result.push(factory.image(asset.data, { alt: "Imported image", ...(width ? { width } : {}), ...(height ? { height } : {}) }));
  }
  return result;
}
type NumberingLevel = { type: "orderedList" | "bulletList"; start: number; format: string };
type NumberingInfo = { levels: Map<number, NumberingLevel>; startOverride?: number };
function readNumbering(zip: JSZip, maxBytes: number): Promise<Map<string, NumberingInfo>> {
  const result = new Map<string, NumberingInfo>();
  if (!zip.file("word/numbering.xml")) return Promise.resolve(result);
  return readXml(zip, "word/numbering.xml", maxBytes).then(xml => {
    const formats = new Map<string, Map<number, NumberingLevel>>();
    for (const abstract of descendants(xml.documentElement as unknown as Element, "abstractNum")) {
      const abstractId = attr(abstract, "abstractNumId");
      if (!abstractId) continue;
      const levels = new Map<number, NumberingLevel>();
      for (const level of elements(abstract, "lvl")) {
        const ilvl = Number(attr(level, "ilvl") ?? "0");
        const fmt = attr(elements(level, "numFmt")[0], "val") ?? "decimal";
        const start = Number(attr(elements(level, "start")[0], "val") ?? "1");
        if (Number.isInteger(ilvl) && ilvl >= 0 && ilvl < 9) levels.set(ilvl, {
          type: fmt === "bullet" ? "bulletList" : "orderedList",
          format: fmt,
          start: Number.isInteger(start) && start > 0 ? start : 1,
        });
      }
      formats.set(abstractId, levels);
    }
    for (const num of descendants(xml.documentElement as unknown as Element, "num")) {
      const numId = attr(num, "numId");
      const abstractId = attr(elements(num, "abstractNumId")[0], "val");
      if (!numId || !abstractId) continue;
      const levels = new Map(formats.get(abstractId) ?? []);
      let startOverride: number | undefined;
      for (const override of elements(num, "lvlOverride")) {
        const ilvl = Number(attr(override, "ilvl") ?? "0");
        if (!Number.isInteger(ilvl) || ilvl < 0 || ilvl > 8) continue;
        const nestedLevel = elements(override, "lvl")[0];
        const previous = levels.get(ilvl) ?? { type: "orderedList" as const, format: "decimal", start: 1 };
        if (nestedLevel) {
          const fmt = attr(elements(nestedLevel, "numFmt")[0], "val") ?? previous.format;
          const start = Number(attr(elements(nestedLevel, "start")[0], "val") ?? previous.start);
          levels.set(ilvl, { type: fmt === "bullet" ? "bulletList" : "orderedList", format: fmt, start: Number.isInteger(start) && start > 0 ? start : previous.start });
        }
        const overrideStart = Number(attr(elements(override, "startOverride")[0], "val"));
        if (ilvl === 0 && Number.isInteger(overrideStart) && overrideStart > 0) startOverride = overrideStart;
      }
      if (levels.size) result.set(numId, { levels, ...(startOverride ? { startOverride } : {}) });
    }
    return result;
  });
}
function numberingFor(paragraph: Element, numbering: Map<string, NumberingInfo>): { numId: string; level: number; info: NumberingInfo; levelInfo: NumberingLevel } | undefined {
  const props = elements(paragraph, "pPr")[0];
  if (!props) return undefined;
  const numPr = elements(props, "numPr")[0];
  const numId = attr(elements(numPr ?? props, "numId")[0], "val");
  if (!numId) return undefined;
  const levelRaw = Number(attr(elements(numPr ?? props, "ilvl")[0], "val") ?? "0");
  const level = Number.isInteger(levelRaw) && levelRaw >= 0 && levelRaw <= 8 ? levelRaw : 0;
  const info = numbering.get(numId);
  const levelInfo = info?.levels.get(level) ?? (level > 0 ? info?.levels.get(level - 1) : undefined);
  return info && levelInfo ? { numId, level, info, levelInfo } : undefined;
}
function blockFromElement(element: Element, relationships: Map<string, { target: string; type?: string }>, media: Map<string, { data: string; mime: string }>, factory: ReturnType<typeof createNodeFactory>, styles: Map<string, ParagraphStyle>, characterStyles: Map<string, CharacterStyle>): BlockNode | undefined {
  if (element.localName === "p") return makeParagraph(element, relationships, media, factory, styles, characterStyles);
  if (element.localName === "tbl") {
    const rows: BlockNode[] = [];
    for (const row of elements(element, "tr")) {
      const cells: BlockNode[] = [];
      for (const cell of elements(row, "tc")) {
        const content = elements(cell, "p").map(p => makeParagraph(p, relationships, media, factory, styles, characterStyles));
        cells.push(factory.block("tableCell", content.length ? content : [factory.paragraph()]));
      }
      if (cells.length) rows.push(factory.block("tableRow", cells));
    }
    return rows.length ? factory.block("table", rows) : undefined;
  }
  return undefined;
}

/**
 * Import a DOCX ZIP package into Convetlib's JSON document model.
 * The importer intentionally supports common semantic OOXML features, not exact Word layout parity.
 */
export async function importDocx(input: Uint8Array | ArrayBuffer, options: DocxImportOptions = {}): Promise<DocumentJSON> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxInput = options.maxInputBytes ?? MAX_INPUT;
  if (!bytes.byteLength || bytes.byteLength > maxInput) throw new RangeError(`DOCX input must be between 1 and ${maxInput} bytes`);
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  const entries = Object.values(zip.files);
  if (entries.length > (options.maxEntries ?? MAX_ENTRIES)) throw new RangeError("DOCX archive contains too many entries");
  const xmlLimit = options.maxXmlPartBytes ?? MAX_XML_PART;
  const documentXml = await readXml(zip, "word/document.xml", xmlLimit);
  const relationships = new Map<string, { target: string; type?: string }>();
  const relsPath = "word/_rels/document.xml.rels";
  if (zip.file(relsPath)) {
    const relsXml = await readXml(zip, relsPath, xmlLimit);
    const relNodes = relsXml.getElementsByTagNameNS(DOC_REL_NS, "Relationship");
    for (let i = 0; i < relNodes.length; i += 1) {
      const rel = relNodes.item(i) as unknown as Element;
      const id = rel.getAttribute("Id");
      const target = rel.getAttribute("Target");
      const type = rel.getAttribute("Type") || undefined;
      if (!id || !target) continue;
      const external = rel.getAttribute("TargetMode") === "External";
      if (external) {
        if (type?.endsWith("/hyperlink") && /^(https?:\/\/|mailto:)/i.test(target)) relationships.set(id, { target, type });
        continue;
      }
      const normalized = target.startsWith("/") ? target.slice(1) : target.startsWith("word/") ? target : `word/${target.replace(/^\.\//, "")}`;
      if (normalized.split("/").includes("..")) continue;
      relationships.set(id, { target: normalized, ...(type ? { type } : {}) });
    }
  }
  const media = new Map<string, { data: string; mime: string }>();
  let mediaBytesTotal = 0;
  for (const rel of relationships.values()) {
    if (!rel.type?.endsWith("/image") || media.has(rel.target)) continue;
    const file = zip.file(rel.target);
    if (!file) continue;
    const blob = await file.async("uint8array");
    mediaBytesTotal += blob.byteLength;
    if (blob.byteLength > 10 * 1024 * 1024 || mediaBytesTotal > 20 * 1024 * 1024) continue;
    const ext = rel.target.split(".").pop()?.toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "bmp" ? "image/bmp" : "";
    if (mime) {
      let binary = "";
      for (let offset = 0; offset < blob.length; offset += 0x8000) binary += String.fromCharCode(...blob.subarray(offset, Math.min(offset + 0x8000, blob.length)));
      media.set(rel.target, { data: `data:${mime};base64,${btoa(binary)}`, mime });
    }
  }
  const body = first(documentXml, "body");
  if (!body) throw new TypeError("DOCX document.xml does not contain a document body");
  const styles = await readParagraphStyles(zip, xmlLimit);
  const characterStyles = await readCharacterStyles(zip, xmlLimit);
  const numbering = await readNumbering(zip, xmlLimit);
  const ids = options.ids ?? createSequentialIdGenerator("docx-");
  const factory = createNodeFactory(ids);
  const content: BlockNode[] = [];
  const bodyElements: Element[] = [];
  for (let i = 0; i < body.childNodes.length; i += 1) {
    const child = body.childNodes.item(i);
    if (child?.nodeType === 1) bodyElements.push(child as Element);
  }
  for (let i = 0; i < bodyElements.length; i += 1) {
    const element = bodyElements[i]!;
    const list = element.localName === "p" ? numberingFor(element, numbering) : undefined;
    if (list) {
      const stack: Array<{ level: number; numId: string; listNode: BlockNode; lastItem?: BlockNode }> = [];
      while (i < bodyElements.length) {
        const candidate = bodyElements[i]!;
        const candidateList = candidate.localName === "p" ? numberingFor(candidate, numbering) : undefined;
        if (!candidateList || candidateList.numId !== list.numId) break;
        const level = Math.min(candidateList.level, stack.length);
        const levelInfo = candidateList.levelInfo;
        const paragraph = makeParagraph(candidate, relationships, media, factory, styles, characterStyles);
        // Keep block images inside their corresponding list item rather than moving them after the whole list.
        const item = factory.listItem([paragraph, ...imagesFromParagraph(candidate, relationships, media, factory)]);
        stack.length = level + 1;
        const current = stack[level];
        let listNode: BlockNode;
        if (current && current.numId === candidateList.numId && current.listNode.type === levelInfo.type) {
          listNode = current.listNode;
          listNode.content = [...(listNode.content ?? []), item];
          current.lastItem = item;
        } else {
          listNode = factory.block(levelInfo.type, [item], levelInfo.type === "orderedList" ? { start: level === 0 ? candidateList.info.startOverride ?? levelInfo.start : levelInfo.start } : undefined);
          if (level > 0 && stack[level - 1]?.lastItem) {
            const parentItem = stack[level - 1]!.lastItem!;
            parentItem.content = [...(parentItem.content ?? []), listNode];
          } else content.push(listNode);
          stack[level] = { level, numId: candidateList.numId, listNode, lastItem: item };
        }
        i += 1;
      }
      i -= 1;
      continue;
    }
    const node = blockFromElement(element, relationships, media, factory, styles, characterStyles);
    if (node) {
      content.push(node);
      if (element.localName === "p") content.push(...imagesFromParagraph(element, relationships, media, factory));
    }
  }
  const sectionProperties = first(body, "sectPr");
  const section = sectionProperties ? readPageSetup(documentXml) : defaultPageSetup();
  const doc = createDocument({ ids, title: options.title ?? "Imported DOCX", content: content.length ? content : [factory.paragraph()], page: section, now: options.now ?? new Date().toISOString() });
  const importSectionPart = async (relationshipType: "header" | "footer"): Promise<BlockNode[] | undefined> => {
    const reference = elements(sectionProperties ?? body, relationshipType + "Reference").find(item => !item.getAttributeNS(WORD_NS, "type") || item.getAttributeNS(WORD_NS, "type") === "default");
    const relationshipId = reference?.getAttributeNS(REL_NS, "id");
    const relationship = relationshipId ? relationships.get(relationshipId) : undefined;
    if (!relationship || !relationship.type?.endsWith("/" + relationshipType) || !zip.file(relationship.target)) return undefined;

    // Header/footer parts have their own .rels file; their image rIds are not
    // the same as the main document's relationship IDs.
    const sectionRelationships = new Map<string, { target: string; type?: string }>();
    const slash = relationship.target.lastIndexOf("/");
    const partDirectory = slash >= 0 ? relationship.target.slice(0, slash) : "";
    const partName = slash >= 0 ? relationship.target.slice(slash + 1) : relationship.target;
    const sectionRelsPath = (partDirectory ? partDirectory + "/" : "") + "_rels/" + partName + ".rels";
    if (zip.file(sectionRelsPath)) {
      const relsXml = await readXml(zip, sectionRelsPath, xmlLimit);
      const relNodes = relsXml.getElementsByTagNameNS(DOC_REL_NS, "Relationship");
      for (let i = 0; i < relNodes.length; i += 1) {
        const rel = relNodes.item(i) as unknown as Element;
        const id = rel.getAttribute("Id");
        const target = rel.getAttribute("Target");
        const type = rel.getAttribute("Type") || undefined;
        if (!id || !target || rel.getAttribute("TargetMode") === "External") continue;
        const segments = target.startsWith("/") ? [] : partDirectory.split("/").filter(Boolean);
        for (const segment of target.replace(/^\//, "").split("/")) {
          if (!segment || segment === ".") continue;
          if (segment === "..") segments.pop();
          else segments.push(segment);
        }
        const normalized = target.startsWith("/") ? target.slice(1) : segments.join("/");
        if (normalized.split("/").includes("..")) continue;
        sectionRelationships.set(id, { target: normalized, ...(type ? { type } : {}) });
      }
    }
    const sectionMedia = new Map<string, { data: string; mime: string }>();
    for (const rel of sectionRelationships.values()) {
      if (!rel.type?.endsWith("/image") || sectionMedia.has(rel.target)) continue;
      const file = zip.file(rel.target);
      if (!file) continue;
      const blob = await file.async("uint8array");
      if (blob.byteLength > 10 * 1024 * 1024) continue;
      const ext = rel.target.split(".").pop()?.toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "bmp" ? "image/bmp" : "";
      if (!mime) continue;
      let binary = "";
      for (let offset = 0; offset < blob.length; offset += 0x8000) binary += String.fromCharCode(...blob.subarray(offset, Math.min(offset + 0x8000, blob.length)));
      sectionMedia.set(rel.target, { data: `data:${mime};base64,${btoa(binary)}`, mime });
    }

    const part = await readXml(zip, relationship.target, xmlLimit);
    const root = part.documentElement as unknown as Element;
    const blocks: BlockNode[] = [];
    for (let i = 0; i < root.childNodes.length; i += 1) {
      const child = root.childNodes.item(i);
      if (child?.nodeType !== 1) continue;
      const element = child as unknown as Element;
      const node = blockFromElement(element, sectionRelationships, sectionMedia, factory, styles, characterStyles);
      if (node) {
        blocks.push(node);
        if (element.localName === "p") blocks.push(...imagesFromParagraph(element, sectionRelationships, sectionMedia, factory));
      }
    }
    return blocks;
  };
  const header = await importSectionPart("header");
  const footer = await importSectionPart("footer");
  if (header) doc.sections[0]!.header = header;
  if (footer) doc.sections[0]!.footer = footer;
  return doc;
}




