import { defaultIdGenerator, type BlockNode } from "@convetlib/core";
import type { ClipboardPayload, ClipboardRun } from "./clipboard";

const voidTags = new Set(["br", "img", "hr", "meta", "link", "input"]);
const blockedTags = new Set(["script", "style", "iframe", "object", "svg", "math", "video", "audio", "form"]);
const blockTags = new Set(["p", "div", "li", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);
const entity = (s: string) => s.replace(/&nbsp;|&#160;|&#xA0;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const m = re.exec(tag);
  return m ? entity(m[1] ?? m[2] ?? m[3] ?? "") : undefined;
}
function id(): string { return defaultIdGenerator(); }
function textNode(value: string): BlockNode { return { type: "paragraph", id: id(), content: value ? [{ type: "text", text: value }] : [] }; }

/** Parses only a small allow-list of structural HTML. No style/event attributes are retained. */
export function htmlToStructuralClipboardPayload(html: string): ClipboardPayload | undefined {
  if (!/<\s*(?:table|ul|ol)\b/i.test(html) && !/<\s*img\b[^>]*\bsrc\s*=\s*(["']https?:\/\/|["']data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(html)) return undefined;
  const tokens = html.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) ?? [];
  const nodes: BlockNode[] = [];
  let paragraphRuns: ClipboardRun[] = [];
  let paragraphTag = "p";
  let marks: Array<"bold" | "italic" | "underline" | "strike" | "code"> = [];
  let blocked: string | undefined;
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
      const paragraph: BlockNode = { type, id: id(), ...(attrs ? { attrs } : {}), content: paragraphRuns.filter(r => r.text).map(r => ({ type: "text", text: r.text, ...(r.marks.length ? { marks: r.marks.map(m => ({ type: m.type })) } : {}) })) };
      const parentItem = itemStack[itemStack.length - 1];
      if (parentItem) parentItem.content?.push(paragraph); else nodes.push(paragraph);
    }
    paragraphRuns = [];
    paragraphTag = "p";
  };
  const flushCell = () => {
    if (!cell) return;
    if (cellRuns.length) cell.content = [{ type: "paragraph", id: id(), content: cellRuns.map(r => ({ type: "text", text: r.text, ...(r.marks.length ? { marks: r.marks.map(m => ({ type: m.type })) } : {}) })) }];
    if (!cell.content?.length) cell.content = [{ type: "paragraph", id: id(), content: [] }];
    row?.content?.push(cell);
    cell = undefined; cellRuns = [];
  };
  const flushRow = () => { flushCell(); if (row) table?.content?.push(row); row = undefined; };
  const flushTable = () => { flushRow(); if (table?.content?.length) nodes.push(table); table = undefined; };

  for (const token of tokens) {
    if (token.startsWith("<!--")) continue;
    const close = /^<\s*\/\s*([a-z0-9]+)[^>]*>$/i.exec(token);
    const open = /^<\s*([a-z0-9]+)\b[^>]*>$/i.exec(token);
    if (close) {
      const t = close[1]!.toLowerCase();
      if (blocked) { if (t === blocked) blocked = undefined; continue; }
      if (blockedTags.has(t)) continue;
      if (t === "td" || t === "th") flushCell();
      else if (t === "tr") flushRow();
      else if (t === "table") flushTable();
      else if (blockTags.has(t)) flushParagraph();
      else if (["b", "strong"].includes(t)) marks = marks.filter(m => m !== "bold");
      else if (["i", "em"].includes(t)) marks = marks.filter(m => m !== "italic");
      else if (t === "u") marks = marks.filter(m => m !== "underline");
      else if (["s", "strike", "del"].includes(t)) marks = marks.filter(m => m !== "strike");
      else if (t === "code") marks = marks.filter(m => m !== "code");
      continue;
    }
    if (open) {
      const t = open[1]!.toLowerCase();
      if (blocked) { if (t === blocked) blocked = blocked; continue; }
      if (blockedTags.has(t)) { blocked = voidTags.has(t) ? undefined : t; continue; }
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
      if (t === "br") { (cell ? cellRuns : paragraphRuns).push({ text: "\n", marks: marks.map(type => ({ type })) }); continue; }
      if (blockTags.has(t)) { flushParagraph(); paragraphTag = t; continue; }
      const mark = t === "b" || t === "strong" ? "bold" : t === "i" || t === "em" ? "italic" : t === "u" ? "underline" : ["s", "strike", "del"].includes(t) ? "strike" : t === "code" ? "code" : undefined;
      if (mark && !marks.includes(mark)) marks.push(mark);
      continue;
    }
    if (blocked) continue;
    const value = entity(token);
    if (!value) continue;
    const target = cell ? cellRuns : paragraphRuns;
    target.push({ text: value, marks: marks.map(type => ({ type })) });
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
