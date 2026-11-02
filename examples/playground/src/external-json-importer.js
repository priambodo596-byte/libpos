// Pure (DOM-free) adapter that turns "external block JSON" (e.g. AI/legal-drafting output with `callout`, `metadataTable`,
// `signatureBlock`, `list{items}`, `table{columns,rows}`, `paragraph{text}`) into a native Convetlib DocumentJSON.
// Native Convetlib JSON never goes through this module (see detectJSONFormat).

export const REGIONS = ['header', 'content', 'footer', 'firstPageHeader', 'firstPageFooter', 'evenPageHeader', 'evenPageFooter'];
const EXTERNAL_BLOCK_TYPES = new Set(['callout', 'metadataTable', 'signatureBlock', 'list']);
const CORE_BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'horizontalRule', 'pageBreak', 'image', 'bulletList', 'orderedList', 'listItem', 'table', 'tableRow', 'tableCell']);
const CORE_INLINE = new Set(['text', 'hardBreak', 'placeholder', 'pageNumber', 'pageCount']);
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*)\s*\}\}/g;
const A4 = { width: 11906, height: 16838 };
const MARGINS = { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 };
const clone = (v) => JSON.parse(JSON.stringify(v));
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ------------------------------------------------------------------ detection

function walk(nodes, visit) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    visit(node);
    walk(node.content, visit);
  }
}

/** Counts constructs that only exist in the external block format. */
export function countExternalMarkers(value) {
  let count = 0;
  for (const section of Array.isArray(value?.sections) ? value.sections : []) {
    if (!isRecord(section)) continue;
    for (const region of REGIONS) {
      walk(section[region], (node) => {
        if (EXTERNAL_BLOCK_TYPES.has(node.type)) count++;
        else if ((node.type === 'paragraph' || node.type === 'heading') && typeof node.text === 'string' && !Array.isArray(node.content)) count++;
        else if (node.type === 'table' && Array.isArray(node.rows) && !Array.isArray(node.content)) count++;
      });
    }
  }
  return count;
}

/** True for JSON written by Convetlib itself: native header shape and no external-only constructs. */
export function isNativeConvetlibJSON(value) {
  return isRecord(value) && value.schemaVersion === 1 && typeof value.id === 'string' && isRecord(value.meta)
    && typeof value.meta.createdAt === 'string' && typeof value.meta.updatedAt === 'string' && Array.isArray(value.sections)
    && value.sections.every((s) => isRecord(s) && typeof s.id === 'string' && isRecord(s.page) && Array.isArray(s.content))
    && countExternalMarkers(value) === 0;
}

/** True when the JSON has a recognisable section/content skeleton that the adapter can convert. */
export function isSupportedExternalJSON(value) {
  return isRecord(value) && Array.isArray(value.sections) && value.sections.length > 0
    && value.sections.every((s) => isRecord(s) && Array.isArray(s.content));
}

/** @returns {'native'|'external'|'unknown'} */
export function detectJSONFormat(value) {
  if (isNativeConvetlibJSON(value)) return 'native';
  return isSupportedExternalJSON(value) ? 'external' : 'unknown';
}

// ------------------------------------------------------------------ inline helpers

const MARK_TYPES = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'superscript', 'subscript', 'link', 'textStyle', 'highlight']);

function cleanMarks(marks) {
  const out = [];
  const seen = new Set();
  for (const mark of Array.isArray(marks) ? marks : []) {
    if (!isRecord(mark) || !MARK_TYPES.has(mark.type) || seen.has(mark.type)) continue;
    if (mark.type === 'link') {
      if (typeof mark.attrs?.href !== 'string' || !mark.attrs.href) continue;
      out.push({ type: 'link', attrs: { href: mark.attrs.href, ...(typeof mark.attrs.title === 'string' ? { title: mark.attrs.title } : {}) } });
    } else if (mark.type === 'textStyle') {
      const a = mark.attrs || {};
      const attrs = {};
      if (typeof a.color === 'string') attrs.color = a.color;
      if (typeof a.fontFamily === 'string') attrs.fontFamily = a.fontFamily;
      if (isNum(a.fontSize) && a.fontSize > 0) attrs.fontSize = a.fontSize;
      out.push({ type: 'textStyle', attrs });
    } else if (mark.type === 'highlight') {
      out.push({ type: 'highlight', attrs: typeof mark.attrs?.color === 'string' ? { color: mark.attrs.color } : {} });
    } else out.push({ type: mark.type });
    seen.add(mark.type);
  }
  return out;
}

/** Splits plain text into text / hardBreak / placeholder nodes. `{{key}}` becomes a real placeholder atom. */
export function inlineFromText(text, marks = []) {
  const out = [];
  const pushText = (chunk) => {
    const lines = chunk.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (i > 0) out.push({ type: 'hardBreak' });
      if (line) out.push({ type: 'text', text: line, ...(marks.length ? { marks: clone(marks) } : {}) });
    });
  };
  const source = String(text ?? '');
  let cursor = 0;
  for (const match of source.matchAll(PLACEHOLDER_RE)) {
    if (match.index > cursor) pushText(source.slice(cursor, match.index));
    out.push({ type: 'placeholder', attrs: { key: match[1] } });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) pushText(source.slice(cursor));
  return out;
}

function sanitizeInline(children) {
  const out = [];
  for (const child of Array.isArray(children) ? children : []) {
    if (!isRecord(child) || !CORE_INLINE.has(child.type)) continue;
    if (child.type === 'text') {
      if (typeof child.text === 'string' && child.text) out.push({ type: 'text', text: child.text, ...(child.marks ? { marks: cleanMarks(child.marks) } : {}) });
    } else if (child.type === 'placeholder') {
      if (typeof child.attrs?.key === 'string' && child.attrs.key) out.push({ type: 'placeholder', attrs: { key: child.attrs.key, ...(typeof child.attrs.fallback === 'string' ? { fallback: child.attrs.fallback } : {}) } });
    } else out.push({ type: child.type });
  }
  return out;
}

function collectText(nodes) {
  let out = '';
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (!isRecord(n)) continue;
    if (n.type === 'text' && typeof n.text === 'string') out += n.text;
    else if (n.type === 'placeholder' && typeof n.attrs?.key === 'string') out += `{{${n.attrs.key}}}`;
    else if (Array.isArray(n.content)) out += collectText(n.content) + ' ';
  }
  return out.trim();
}

// ------------------------------------------------------------------ attr helpers

const TEXT_ATTRS = ['align', 'spacingBefore', 'spacingAfter', 'lineSpacing', 'lineSpacingRule', 'indentLeft', 'indentRight', 'firstLineIndent', 'hangingIndent', 'styleId', 'styleName', 'styleBasedOn'];
const ALIGN = new Set(['left', 'center', 'right', 'justify']);

function textAttrs(node, extra = {}) {
  const src = { ...(isRecord(node.attrs) ? node.attrs : {}) };
  if (node.align !== undefined && src.align === undefined) src.align = node.align;
  const attrs = {};
  for (const key of TEXT_ATTRS) {
    const v = src[key];
    if (v === undefined) continue;
    if (key === 'align') { if (ALIGN.has(v)) attrs.align = v; }
    else if (key === 'lineSpacingRule') { if (['auto', 'exact', 'atLeast'].includes(v)) attrs[key] = v; }
    else if (typeof v === 'string' && ['styleId', 'styleName', 'styleBasedOn'].includes(key)) attrs[key] = v;
    else if (isNum(v) && (['indentLeft', 'indentRight', 'firstLineIndent', 'hangingIndent'].includes(key) || v >= 0)) attrs[key] = v;
  }
  for (const key of ['positionX', 'positionY']) if (node.type === 'paragraph' && isNum(src[key]) && src[key] >= 0) attrs[key] = src[key];
  if (node.type === 'paragraph' && isNum(src.boxWidth) && src.boxWidth > 0) attrs.boxWidth = src.boxWidth;
  return { ...attrs, ...extra };
}

function sanitizePage(page, fallback) {
  const base = fallback || { size: A4, orientation: 'portrait', margins: MARGINS };
  if (!isRecord(page)) return clone(base);
  const size = isRecord(page.size) && isNum(page.size.width) && isNum(page.size.height) && page.size.width > 0 && page.size.height > 0 ? { width: page.size.width, height: page.size.height } : clone(base.size);
  const margins = { ...MARGINS, ...(isRecord(base.margins) ? base.margins : {}) };
  if (isRecord(page.margins)) for (const key of Object.keys(MARGINS)) if (isNum(page.margins[key]) && page.margins[key] >= 0) margins[key] = page.margins[key];
  return { size, orientation: page.orientation === 'landscape' ? 'landscape' : 'portrait', margins };
}

// ------------------------------------------------------------------ converter

/**
 * @param {object} raw external JSON (not mutated)
 * @param {{generateId:()=>string, now?:string, defaultPage?:object}} options
 * @returns {{document:object, report:object}}
 */
export function convertExternalDocumentJSON(raw, options = {}) {
  if (!isRecord(raw) || !Array.isArray(raw.sections)) throw new Error('JSON eksternal harus memiliki array sections');
  const source = clone(raw);
  const now = options.now || new Date().toISOString();
  let counter = 0;
  const generate = options.generateId || (() => `ext-${++counter}`);
  const used = new Set();
  const claim = (preferred) => {
    if (typeof preferred === 'string' && preferred && !used.has(preferred)) { used.add(preferred); return preferred; }
    for (let i = 0; i < 10000; i++) { const id = generate(); if (typeof id === 'string' && id && !used.has(id)) { used.add(id); return id; } }
    throw new Error('Id generator did not produce a unique id');
  };
  const report = { sections: 0, blocks: {}, unknownNodes: 0, comments: 0, anchoredComments: 0, revisionsPreserved: 0, warnings: [] };
  const custom = { externalFormat: 'block-json', sourceId: typeof source.id === 'string' ? source.id : null, callouts: [], unknownNodes: [] };
  const blockById = new Map();
  const count = (type) => { report.blocks[type] = (report.blocks[type] || 0) + 1; };

  let contentWidth = A4.width - MARGINS.left - MARGINS.right;

  const para = (text, { attrs = {}, marks = [], extId } = {}) => ({ type: 'paragraph', id: claim(extId), ...(Object.keys(attrs).length ? { attrs } : {}), content: inlineFromText(text, marks) });
  const cell = (blocks, attrs = {}) => ({ type: 'tableCell', id: claim(), ...(Object.keys(attrs).length ? { attrs } : {}), content: blocks.length ? blocks : [para('')] });
  const row = (cells) => ({ type: 'tableRow', id: claim(), content: cells });
  const BORDER = '1px solid #000000';
  const borders = { borderTop: BORDER, borderRight: BORDER, borderBottom: BORDER, borderLeft: BORDER };

  function listItemsFrom(items, ordered, extId, extAttrs) {
    const children = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (typeof item === 'string' || typeof item === 'number') children.push({ type: 'listItem', id: claim(), content: [para(String(item))] });
      else if (isRecord(item) && Array.isArray(item.content) && item.type === 'listItem') children.push({ type: 'listItem', id: claim(item.id), content: convertBlocks(item.content) || [para('')] });
      else if (isRecord(item)) {
        const blocks = [para(item.text ?? item.label ?? '')];
        if (Array.isArray(item.items) && item.items.length) blocks.push(listItemsFrom(item.items, item.ordered === true || ordered, undefined, {}));
        children.push({ type: 'listItem', id: claim(), content: blocks });
      }
    }
    if (!children.length) children.push({ type: 'listItem', id: claim(), content: [para('')] });
    const start = isNum(extAttrs?.start) && Number.isInteger(extAttrs.start) && extAttrs.start > 0 ? extAttrs.start : undefined;
    return { type: ordered ? 'orderedList' : 'bulletList', id: claim(extId), ...(ordered && start ? { attrs: { start } } : {}), content: children };
  }

  function convertTable(node) {
    const columns = Array.isArray(node.columns) ? node.columns.filter(isRecord) : [];
    const rowsIn = Array.isArray(node.rows) ? node.rows : [];
    const keys = columns.length ? columns.map((c, i) => (c.key ?? String(i))) : (isRecord(rowsIn[0]) ? Object.keys(rowsIn[0]) : Array.isArray(rowsIn[0]) ? rowsIn[0].map((_, i) => i) : []);
    const total = columns.reduce((sum, c) => sum + (isNum(c.width) && c.width > 0 ? c.width : 0), 0);
    const widthOf = (i) => {
      const w = columns[i]?.width;
      if (isNum(w) && w > 0) return Math.max(1, Math.round(total > 0 ? (w / total) * contentWidth : w));
      return keys.length ? Math.round(contentWidth / keys.length) : undefined;
    };
    const rows = [];
    if (columns.some((c) => typeof c.label === 'string' && c.label)) {
      rows.push(row(keys.map((_, i) => cell([para(columns[i]?.label ?? '', { marks: [{ type: 'bold' }], attrs: { align: 'left' } })], { ...borders, backgroundColor: '#EEEEEE', ...(widthOf(i) ? { width: widthOf(i) } : {}) }))));
    }
    for (const r of rowsIn) {
      rows.push(row(keys.map((key, i) => {
        const value = Array.isArray(r) ? r[i] : isRecord(r) ? r[key] : r;
        const blocks = Array.isArray(value) ? value.map((v) => para(typeof v === 'string' ? v : collectText([v]))) : [para(value ?? '')];
        return cell(blocks, { ...borders, ...(widthOf(i) ? { width: widthOf(i) } : {}) });
      })));
    }
    if (!rows.length) rows.push(row([cell([para('')], borders)]));
    return { type: 'table', id: claim(node.id), attrs: { width: contentWidth, layout: 'fixed' }, content: rows };
  }

  function convertBlock(node) {
    if (!isRecord(node)) return [];
    const type = node.type;
    if (type === 'heading' || type === 'paragraph') {
      count(type);
      let content;
      if (Array.isArray(node.content)) content = sanitizeInline(node.content);
      else {
        const marks = type === 'paragraph' && node.variant === 'note' ? [{ type: 'italic' }]
          : type === 'paragraph' && node.variant === 'muted' ? [{ type: 'italic' }, { type: 'textStyle', attrs: { color: '#666666' } }] : [];
        content = inlineFromText(node.text ?? '', marks);
      }
      const lv = Number(node.level ?? node.attrs?.level ?? node.attrs?.headingLevel ?? node.attrs?.outlineLevel);
      const level = Number.isInteger(lv) && lv >= 1 && lv <= 6 ? lv : 1;
      const out = { type, id: claim(node.id), attrs: textAttrs(node, type === 'heading' ? { level } : {}), content };
      if (typeof node.id === 'string') blockById.set(node.id, out);
      return [out];
    }
    if (type === 'list' || type === 'bulletList' || type === 'orderedList') {
      count('list');
      const ordered = type === 'orderedList' || node.ordered === true || /order|number/i.test(String(node.attrs?.listType ?? node.listType ?? ''));
      const items = Array.isArray(node.items) ? node.items : Array.isArray(node.content) ? node.content : [];
      const out = listItemsFrom(items, ordered, node.id, node.attrs);
      if (typeof node.id === 'string') blockById.set(node.id, out);
      return [out];
    }
    if (type === 'table' && Array.isArray(node.content) && !Array.isArray(node.rows)) {
      count('table');
      const rows = node.content.filter((r) => isRecord(r) && r.type === 'tableRow').map((r) => ({
        type: 'tableRow', id: claim(r.id), ...(isNum(r.attrs?.height) && r.attrs.height > 0 ? { attrs: { height: r.attrs.height } } : {}),
        content: (Array.isArray(r.content) ? r.content : []).filter((c) => isRecord(c) && c.type === 'tableCell').map((c) => {
          const a = isRecord(c.attrs) ? c.attrs : {};
          const attrs = {};
          for (const k of ['colspan', 'rowspan']) if (Number.isInteger(a[k]) && a[k] > 0) attrs[k] = a[k];
          if (isNum(a.width) && a.width > 0) attrs.width = a.width;
          if (typeof a.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(a.backgroundColor)) attrs.backgroundColor = a.backgroundColor;
          if (['top', 'center', 'bottom'].includes(a.verticalAlign)) attrs.verticalAlign = a.verticalAlign;
          for (const k of ['borderTop', 'borderRight', 'borderBottom', 'borderLeft']) if (typeof a[k] === 'string') attrs[k] = a[k];
          return cell(convertBlocks(c.content), attrs);
        }),
      }));
      const ta = isRecord(node.attrs) ? node.attrs : {};
      const out = { type: 'table', id: claim(node.id), ...(isNum(ta.width) || ta.layout ? { attrs: { ...(isNum(ta.width) && ta.width > 0 ? { width: ta.width } : {}), ...(ta.layout === 'fixed' || ta.layout === 'autofit' ? { layout: ta.layout } : {}) } } : {}), content: rows.length ? rows : [row([cell([para('')])])] };
      if (typeof node.id === 'string') blockById.set(node.id, out);
      return [out];
    }
    if (type === 'table') {
      count('table');
      const out = convertTable(node);
      if (typeof node.id === 'string') blockById.set(node.id, out);
      return [out];
    }
    if (type === 'metadataTable') {
      count(type);
      const rows = (Array.isArray(node.rows) ? node.rows : []).map((r) => row([
        cell([para(r?.label ?? '', { marks: [{ type: 'bold' }] })], { ...borders, backgroundColor: '#EEEEEE', width: Math.round(contentWidth * 0.3) }),
        cell([para(r?.value ?? '')], { ...borders, width: Math.round(contentWidth * 0.7) }),
      ]));
      const out = { type: 'table', id: claim(node.id), attrs: { width: contentWidth, layout: 'fixed' }, content: rows.length ? rows : [row([cell([para('')], borders)])] };
      if (typeof node.id === 'string') blockById.set(node.id, out);
      return [out];
    }
    if (type === 'callout') {
      count(type);
      const children = [];
      if (node.title) children.push(para(node.title, { marks: [{ type: 'bold' }] }));
      if (node.text) children.push(para(node.text));
      if (!children.length) children.push(para(''));
      const out = { type: 'blockquote', id: claim(node.id), content: children };
      custom.callouts.push({ id: out.id, variant: node.variant ?? null, title: node.title ?? null });
      if (typeof node.id === 'string') blockById.set(node.id, out);
      return [out];
    }
    if (type === 'signatureBlock') {
      count(type);
      const cols = (Array.isArray(node.columns) ? node.columns : []).filter(isRecord);
      const w = cols.length ? Math.round(contentWidth / cols.length) : undefined;
      const cells = cols.map((c) => cell([
        para(c.role ?? '', { marks: [{ type: 'bold' }], attrs: { align: 'center' } }),
        para('', { attrs: { align: 'center' } }), para('', { attrs: { align: 'center' } }), para('', { attrs: { align: 'center' } }),
        para(c.name ?? '', { marks: [{ type: 'bold' }], attrs: { align: 'center' } }),
        para(c.title ?? '', { attrs: { align: 'center' } }),
        para(c.company ?? '', { attrs: { align: 'center' } }),
      ], { ...(w ? { width: w } : {}), borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none' }));
      const out = { type: 'table', id: claim(node.id), attrs: { width: contentWidth, layout: 'fixed' }, content: [row(cells.length ? cells : [cell([para('')])])] };
      if (typeof node.id === 'string') blockById.set(node.id, out);
      return [out];
    }
    if (type === 'image') {
      if (typeof node.attrs?.src !== 'string' || !node.attrs.src) return [];
      count(type);
      const a = node.attrs;
      const attrs = { src: a.src };
      if (typeof a.alt === 'string') attrs.alt = a.alt;
      for (const k of ['width', 'height']) if (isNum(a[k]) && a[k] > 0) attrs[k] = a[k];
      if (['left', 'center', 'right'].includes(a.align)) attrs.align = a.align;
      for (const k of ['positionX', 'positionY']) if (isNum(a[k]) && a[k] >= 0) attrs[k] = a[k];
      return [{ type: 'image', id: claim(node.id), attrs }];
    }
    if (type === 'horizontalRule' || type === 'pageBreak') { count(type); return [{ type, id: claim(node.id) }]; }
    if (type === 'blockquote') { count(type); return [{ type, id: claim(node.id), content: convertBlocks(node.content) || [para('')] }]; }
    if (type === 'codeBlock') {
      count(type);
      const text = typeof node.text === 'string' ? node.text : collectText(node.content);
      return [{ type, id: claim(node.id), ...(typeof node.attrs?.language === 'string' ? { attrs: { language: node.attrs.language } } : {}), content: text ? [{ type: 'text', text }] : [] }];
    }
    if (CORE_BLOCKS.has(type)) { // stray row/cell/listItem outside its container: keep the text
      const text = collectText(node.content);
      return [para(text)];
    }
    // Unknown node: never drop silently. Keep its text as a paragraph and its raw JSON in meta.custom.
    report.unknownNodes++;
    report.warnings.push(`Node tidak dikenal "${String(type)}" dikonversi menjadi paragraf`);
    const text = typeof node.text === 'string' ? node.text : collectText(node.content) || collectText(node.items?.map?.((t) => ({ type: 'text', text: String(t) })));
    custom.unknownNodes.push({ type: String(type), id: typeof node.id === 'string' ? node.id : null, raw: node });
    return [para(text)];
  }

  function convertBlocks(nodes) {
    const out = [];
    for (const n of Array.isArray(nodes) ? nodes : []) out.push(...convertBlock(n));
    return out.length ? out : null;
  }

  // ---- metadata
  const meta = isRecord(source.meta) ? source.meta : {};
  const { title, language, createdAt, updatedAt, ...extraMeta } = meta;
  custom.sourceMeta = extraMeta;
  if (source.placeholders !== undefined) custom.placeholders = source.placeholders;
  if (source.schemaVersion !== undefined) custom.sourceSchemaVersion = source.schemaVersion;

  // ---- sections
  const sections = [];
  const fallbackPage = options.defaultPage ? sanitizePage(options.defaultPage) : null;
  for (const s of source.sections) {
    if (!isRecord(s)) continue;
    const page = sanitizePage(s.page, fallbackPage);
    contentWidth = Math.max(1440, page.size.width - page.margins.left - page.margins.right);
    if (page.orientation === 'landscape') contentWidth = Math.max(1440, page.size.height - page.margins.left - page.margins.right);
    const section = { id: claim(s.id), page };
    if (s.kind === 'canvas' || s.kind === 'flow') section.kind = s.kind;
    for (const region of REGIONS) {
      if (!Array.isArray(s[region])) continue;
      const blocks = convertBlocks(s[region]);
      if (region === 'content') section.content = blocks || [para('')];
      else if (blocks) section[region] = blocks;
      else if (region !== 'header' && region !== 'footer') section[region] = [];
    }
    if (!section.content) section.content = [para('')];
    sections.push(section);
  }
  if (!sections.length) throw new Error('JSON eksternal tidak memiliki section yang valid');
  report.sections = sections.length;

  // ---- comments (+ anchors) and revisions
  const toEntries = (value) => Array.isArray(value) ? value.filter(isRecord).map((v, i) => [String(v.id ?? `item-${i + 1}`), v])
    : isRecord(value) ? Object.entries(value).map(([k, v]) => [k, isRecord(v) ? v : { message: typeof v === 'string' ? v : '' }]) : [];
  const comments = {};
  const anchors = {};
  const textNodesOf = (node, acc = []) => { for (const c of node.content || []) { if (c.type === 'text') acc.push(c); else if (Array.isArray(c.content)) textNodesOf(c, acc); } return acc; };
  for (const [key, c] of toEntries(source.comments)) {
    const id = key;
    const nowIso = typeof c.createdAt === 'string' && c.createdAt ? c.createdAt : now;
    const status = String(c.status ?? '').toLowerCase();
    comments[id] = {
      id,
      authorId: String(c.authorId ?? c.author ?? 'unknown'),
      createdAt: nowIso,
      body: typeof c.body === 'string' ? c.body : typeof c.message === 'string' ? c.message : typeof c.text === 'string' ? c.text : '',
      resolved: typeof c.resolved === 'boolean' ? c.resolved : status === 'resolved' || status === 'closed' || status === 'done',
      replies: (Array.isArray(c.replies) ? c.replies : []).map((r, i) => ({
        id: String(r?.id ?? `${id}-reply-${i}`), authorId: String(r?.authorId ?? r?.author ?? 'unknown'),
        createdAt: typeof r?.createdAt === 'string' && r.createdAt ? r.createdAt : nowIso, body: String(r?.body ?? r?.message ?? (typeof r === 'string' ? r : '')),
      })),
    };
    report.comments++;
    const extra = { role: c.role ?? null, status: c.status ?? null, anchor: c.anchor ?? null };
    anchors[id] = extra;
    const target = typeof c.anchor === 'string' ? blockById.get(c.anchor) : undefined;
    if (target) {
      const texts = textNodesOf(target);
      const marked = TEXTBLOCKS.has(target.type) ? texts : texts.slice(0, 1);
      for (const t of marked) {
        t.marks = t.marks || [];
        if (!t.marks.some((m) => m.type === 'comment')) t.marks.push({ type: 'comment', attrs: { commentId: id } });
      }
      if (marked.length) report.anchoredComments++;
    }
  }
  custom.comments = anchors;
  const history = toEntries(source.revisions).map(([key, r]) => ({ ...r, id: key }));
  if (history.length) { custom.revisionHistory = history; report.revisionsPreserved = history.length; }
  if (!custom.callouts.length) delete custom.callouts;
  if (!custom.unknownNodes.length) delete custom.unknownNodes;

  const document = {
    schemaVersion: 1,
    id: typeof source.id === 'string' && source.id ? source.id : claim(),
    meta: {
      title: typeof title === 'string' && title ? title : 'Imported document',
      language: typeof language === 'string' ? language : 'id',
      createdAt: typeof createdAt === 'string' && createdAt ? createdAt : now,
      updatedAt: typeof updatedAt === 'string' && updatedAt ? updatedAt : now,
      custom: { externalImport: custom },
    },
    sections,
    comments,
    revisions: {},
  };
  return { document, report };
}
