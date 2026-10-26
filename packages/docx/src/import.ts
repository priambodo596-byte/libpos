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
function twipsToPoints(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed / 20) : fallback;
}
function readPageSetup(documentXml: XmlDocument): PageSetup {
  const sect = first(documentXml, "sectPr");
  const size = sect ? first(sect, "pgSz") : undefined;
  const margins = sect ? first(sect, "pgMar") : undefined;
  const base = defaultPageSetup();
  const width = twipsToPoints(attr(size, "w"), base.size.width);
  const height = twipsToPoints(attr(size, "h"), base.size.height);
  return {
    size: { width, height },
    orientation: attr(size, "orient") === "landscape" || width > height ? "landscape" : "portrait",
    margins: {
      top: twipsToPoints(attr(margins, "top"), base.margins.top),
      right: twipsToPoints(attr(margins, "right"), base.margins.right),
      bottom: twipsToPoints(attr(margins, "bottom"), base.margins.bottom),
      left: twipsToPoints(attr(margins, "left"), base.margins.left),
      header: twipsToPoints(attr(margins, "header"), base.margins.header),
      footer: twipsToPoints(attr(margins, "footer"), base.margins.footer),
    },
  };
}
function paragraphMarks(run: Element): Mark[] {
  const props = elements(run, "rPr")[0];
  if (!props) return [];
  const marks: Mark[] = [];
  const has = (name: string) => elements(props, name).some(item => attr(item, "val") !== "0" && attr(item, "val") !== "false");
  if (has("b")) marks.push({ type: "bold" });
  if (has("i")) marks.push({ type: "italic" });
  if (has("u")) marks.push({ type: "underline" });
  if (has("strike") || has("dstrike")) marks.push({ type: "strike" });
  if (has("vertAlign")) {
    const align = attr(elements(props, "vertAlign")[0], "val");
    if (align === "superscript") marks.push({ type: "superscript" });
    if (align === "subscript") marks.push({ type: "subscript" });
  }
  return marks;
}
function runContent(paragraph: Element, relationships: Map<string, { target: string; type?: string }>, media: Map<string, { data: string; mime: string }>, factory: ReturnType<typeof createNodeFactory>): Inline[] {
  const inline: Inline[] = [];
  const process = (element: Element) => {
    if (element.namespaceURI !== WORD_NS) {
      if (element.localName === "drawing" || element.localName === "pict") {
        const blip = element.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "blip").item(0) as Element | null;
        const id = blip?.getAttributeNS(REL_NS, "embed");
        const relationship = id ? relationships.get(id) : undefined;
        const asset = relationship ? media.get(relationship.target) : undefined;
        if (asset) inline.push({ type: "text", text: "[Image]" });
      }
      return;
    }
    if (element.localName === "t" || element.localName === "delText") {
      const text = element.textContent ?? "";
      if (text) inline.push({ type: "text", text, ...(element.parentElement ? { marks: paragraphMarks(element.parentElement) } : {}) });
    } else if (element.localName === "tab") {
      inline.push({ type: "text", text: "\t" });
    } else if (element.localName === "br" || element.localName === "cr") {
      inline.push({ type: "hardBreak" });
    } else if (element.localName === "r") {
      const marks = paragraphMarks(element);
      for (const child of elements(element, "t").concat(elements(element, "delText"))) {
        const text = child.textContent ?? "";
        if (text) inline.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
      }
      for (const child of elements(element, "tab")) { void child; inline.push({ type: "text", text: "\t", ...(marks.length ? { marks } : {}) }); }
      for (const child of elements(element, "br").concat(elements(element, "cr"))) { void child; inline.push({ type: "hardBreak" }); }
      for (const child of elements(element, "drawing")) {
        const blip = child.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "blip").item(0) as unknown as Element | null;
        const relationshipId = blip?.getAttributeNS(REL_NS, "embed");
        const relationship = relationshipId ? relationships.get(relationshipId) : undefined;
        const asset = relationship ? media.get(relationship.target) : undefined;
        if (asset) inline.push({ type: "text", text: "[Imported image]" });
      }
    } else if (element.localName === "hyperlink") {
      for (const child of elements(element, "r")) process(child);
    }
  };
  for (let i = 0; i < paragraph.childNodes.length; i += 1) {
    const child = paragraph.childNodes.item(i);
    if (child?.nodeType === 1) process(child as Element);
  }
  return inline;
}
function makeParagraph(element: Element, relationships: Map<string, { target: string; type?: string }>, media: Map<string, { data: string; mime: string }>, factory: ReturnType<typeof createNodeFactory>): BlockNode {
  const props = elements(element, "pPr")[0];
  const style = attr(elements(props ?? element, "pStyle")[0], "val");
  const heading = style?.match(/^Heading([1-6])$/i);
  const inline = runContent(element, relationships, media, factory);
  const node = heading ? factory.heading(Number(heading[1]) as 1 | 2 | 3 | 4 | 5 | 6, inline) : factory.paragraph(inline);
  const align = attr(elements(props ?? element, "jc")[0], "val");
  if (["left", "center", "right", "both", "distribute"].includes(align ?? "")) node.attrs = { ...(node.attrs ?? {}), align: align === "both" || align === "distribute" ? "justify" : align! };
  return node;
}
function blockFromElement(element: Element, relationships: Map<string, { target: string; type?: string }>, media: Map<string, { data: string; mime: string }>, factory: ReturnType<typeof createNodeFactory>): BlockNode | undefined {
  if (element.localName === "p") return makeParagraph(element, relationships, media, factory);
  if (element.localName === "tbl") {
    const rows: BlockNode[] = [];
    for (const row of elements(element, "tr")) {
      const cells: BlockNode[] = [];
      for (const cell of elements(row, "tc")) {
        const content = elements(cell, "p").map(p => makeParagraph(p, relationships, media, factory));
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
      if (!id || !target || rel.getAttribute("TargetMode") === "External") continue;
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
  const ids = options.ids ?? createSequentialIdGenerator("docx-");
  const factory = createNodeFactory(ids);
  const content: BlockNode[] = [];
  for (let i = 0; i < body.childNodes.length; i += 1) {
    const child = body.childNodes.item(i);
    if (child?.nodeType !== 1) continue;
    const element = child as Element;
    const node = blockFromElement(element, relationships, media, factory);
    if (node) content.push(node);
  }
  const section = first(body, "sectPr") ? readPageSetup(documentXml) : defaultPageSetup();
  const doc = createDocument({ ids, title: options.title ?? "Imported DOCX", content: content.length ? content : [factory.paragraph()], page: section, now: options.now ?? new Date().toISOString() });
  return doc;
}




