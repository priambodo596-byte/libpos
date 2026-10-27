import { defaultIdGenerator, type BlockNode, type Mark } from "@convetlib/core";
import type { ClipboardPayload, ClipboardRun } from "./clipboard";

const voidTags = new Set(["br", "img", "hr", "meta", "link", "input"]);
const blockedTags = new Set(["script", "style", "iframe", "object", "svg", "math", "video", "audio", "form"]);
const blockTags = new Set(["p", "div", "li", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);
const namedEntities: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** Decodes entities in a single pass so `&amp;lt;` yields the literal text `&lt;`, not `<`. */
const entity = (s: string) => s.replace(/&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|([a-z]+));/gi, (whole, hex?: string, dec?: string, name?: string) => {
  if (name) return namedEntities[name.toLowerCase()] ?? whole;
  const code = hex !== undefined ? parseInt(hex, 16) : Number(dec);
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
  return code === 0xa0 ? " " : String.fromCodePoint(code);
});

function attr(tag: string, name: string): string | undefined {
  const start = /^<\s*[a-z0-9]+/i.exec(tag);
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  re.lastIndex = start ? start[0].length : 0;
  const wanted = name.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    if (m[1]!.toLowerCase() === wanted) return entity(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return undefined;
}
function id(): string { return defaultIdGenerator(); }
function safeLinkHref(value: string): string | undefined {
  const href = value.trim();
  if (!href || /[\u0000-\u0020\u007f]/.test(href)) return undefined;
  if (/^(?:https?:|mailto:|tel:)/i.test(href)) return href;
  return undefined;
}

/** Parses only a small allow-list of structural HTML. No style/event attributes are retained. */
export function htmlToStructuralClipboardPayload(html: string): ClipboardPayload | undefined {
  if (!/<\s*(?:table|ul|ol|a)\b/i.test(html) && !/<\s*img\b[^>]*\bsrc\s*=\s*(["']https?:\/\/|["']data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(html)) return undefined;
  const tokens = html.match(/<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^>"'])*>|[^<]+/g) ?? [];
  const nodes: BlockNode[] = [];
  let paragraphRuns: ClipboardRun[] = [];
  let paragraphTag = "p";
  let marks: Array<"bold" | "italic" | "underline" | "strike" | "code" | Mark> = [];
  let blocked: string | undefined;
  let blockedDepth = 0;
  let table: BlockNode | undefined;
  let row: BlockNode | undefined;
  let cell: BlockNode | undefined;
  let cellRuns: ClipboardRun[] = [];
  const listStack: BlockNode[] = [];
  const itemStack: BlockNode[] = [];

  const flushParagraph = () => {
    if (paragraphRuns.length) {
      const type = paragraphTag === "pre" ? "codeBlock" : /^h[1-6]$/.test(paragraphTag) ? "heading" : "paragraph";
      const attrs = /^h[1-6]$/.test(paragraphTag) ? { level: Number(paragraphTag.slice(1)) } : undefined;
      const paragraph: BlockNode = { type, id: id(), ...(attrs ? { attrs } : {}), content: paragraphRuns.filter(r => r.text).map(r => ({ type: "text", text: r.text, ...(r.marks.length ? { marks: r.marks.map(m => typeof m === "string" ? ({ type: m }) : m) } : {}) })) };
      const parentItem = itemStack[itemStack.length - 1];
      if (parentItem) parentItem.content?.push(paragraph); else nodes.push(paragraph);
    }
    paragraphRuns = [];
    paragraphTag = "p";
  };
  const flushCell = () => {
    if (!cell) return;
    if (cellRuns.length) cell.content = [{ type: "paragraph", id: id(), content: cellRuns.map(r => ({ type: "text", text: r.text, ...(r.marks.length ? { marks: r.marks.map(m => typeof m === "string" ? ({ type: m }) : m) } : {}) })) }];
    if (!cell.content?.length) cell.content = [{ type: "paragraph", id: id(), content: [] }];
    row?.content?.push(cell);
    cell = undefined; cellRuns = [];
  };
  const flushRow = () => { flushCell(); if (row) table?.content?.push(row); row = undefined; };
  const flushTable = () => { flushRow(); if (table?.content?.length) nodes.push(table); table = undefined; };

  for (const token of tokens) {
    if (token.startsWith("<!--")) continue;
    const close = /^<\s*\/\s*([a-z0-9]+)[\s\S]*>$/i.exec(token);
    const open = /^<\s*([a-z0-9]+)\b[\s\S]*>$/i.exec(token);
    if (close) {
      const t = close[1]!.toLowerCase();
      if (blocked) { if (t === blocked && --blockedDepth === 0) blocked = undefined; continue; }
      if (blockedTags.has(t)) continue;
      if (t === "td" || t === "th") flushCell();
      else if (t === "tr") flushRow();
      else if (t === "table") flushTable();
      else if (blockTags.has(t)) flushParagraph();
      else if (t === "a") marks = marks.filter(m => typeof m === "string" || m.type !== "link");
      else if (["b", "strong"].includes(t)) marks = marks.filter(m => m !== "bold");
      else if (["i", "em"].includes(t)) marks = marks.filter(m => m !== "italic");
      else if (t === "u") marks = marks.filter(m => m !== "underline");
      else if (["s", "strike", "del"].includes(t)) marks = marks.filter(m => m !== "strike");
      else if (t === "code") marks = marks.filter(m => m !== "code");
      continue;
    }
    if (open) {
      const t = open[1]!.toLowerCase();
      if (blocked) { if (t === blocked) blockedDepth += 1; continue; }
      if (blockedTags.has(t)) { if (/\/\s*>$/.test(token)) continue; blocked = voidTags.has(t) ? undefined : t; blockedDepth = blocked ? 1 : 0; continue; }
      if (t === "table") { flushParagraph(); flushTable(); table = { type: "table", id: id(), content: [] }; continue; }
      if (t === "ul" || t === "ol") {
        flushParagraph();
        const list: BlockNode = { type: t === "ul" ? "bulletList" : "orderedList", id: id(), ...(t === "ol" ? { attrs: { start: Math.max(1, Math.min(100000, Number(attr(token, "start") ?? 1) || 1)) } } : {}), content: [] };
        const parent = itemStack[itemStack.length - 1];
        if (parent) parent.content?.push(list); else nodes.push(list);
        listStack.push(list); continue;
      }
      if (t === "li" && listStack.length) {
        flushParagraph();
        const item: BlockNode = { type: "listItem", id: id(), content: [] };
        listStack[listStack.length - 1]!.content?.push(item); itemStack.push(item); paragraphTag = "p"; continue;
      }
      if (t === "tr" && table) { flushRow(); row = { type: "tableRow", id: id(), content: [] }; continue; }
      if ((t === "td" || t === "th") && row) {
        flushCell();
        const boundedSpan = (name: "colspan" | "rowspan") => {
          const raw = Number(attr(token, name) ?? 1);
          return Number.isInteger(raw) && raw >= 1 && raw <= 100 ? raw : 1;
        };
        cell = { type: "tableCell", id: id(), attrs: { colspan: boundedSpan("colspan"), rowspan: boundedSpan("rowspan") }, content: [] };
        cellRuns = [];
        continue;
      }
      if (t === "a") {
        const href = safeLinkHref(attr(token, "href") ?? "");
        if (href) marks.push({ type: "link", attrs: { href, ...(attr(token, "title") ? { title: attr(token, "title")! } : {}) } });
        continue;
      }
      if (t === "img") {
        const src = attr(token, "src");
        if (src && /^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(src)) {
          flushParagraph();
          const imageAttrs: NonNullable<BlockNode["attrs"]> = { src };
          const alt = attr(token, "alt"); if (alt) imageAttrs.alt = alt;
          for (const key of ["width", "height"] as const) { const n = Number(attr(token, key)); if (Number.isFinite(n) && n > 0 && n <= 10000) imageAttrs[key] = n; }
          nodes.push({ type: "image", id: id(), attrs: imageAttrs });
        }
        continue;
      }
      if (t === "br") { (cell ? cellRuns : paragraphRuns).push({ text: "\n", marks: marks.map(m => typeof m === "string" ? ({ type: m }) : m) }); continue; }
      if (blockTags.has(t)) { flushParagraph(); paragraphTag = t; continue; }
      const mark = t === "b" || t === "strong" ? "bold" : t === "i" || t === "em" ? "italic" : t === "u" ? "underline" : ["s", "strike", "del"].includes(t) ? "strike" : t === "code" ? "code" : undefined;
      if (mark && !marks.includes(mark)) marks.push(mark);
      continue;
    }
    if (blocked) continue;
    const value = entity(token);
    if (!value) continue;
    const target = cell ? cellRuns : paragraphRuns;
    target.push({ text: value, marks: marks.map(m => typeof m === "string" ? ({ type: m }) : m) });
  }
  flushParagraph();
  flushTable();
  if (!nodes.length) return undefined;
  const plainText = (n: BlockNode): string => {
    if (n.type === "image") return "\uFFFC";
    if (n.type === "text") return (n as unknown as { text: string }).text;
    return (n.content ?? []).map(c => plainText(c as BlockNode)).join(n.type === "paragraph" || n.type === "heading" || n.type === "codeBlock" ? "" : "\t");
  };
  const text = nodes.map(plainText).join("\n");
  return { mime: "application/x-convetlib-fragment+json", text, nodes };
}
