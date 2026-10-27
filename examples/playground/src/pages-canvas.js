// Pages panel, manual-design canvas and INSPECTOR field drag & drop for the Convetlib playground.
// Kept in its own module so main.js only wires it in (see initPagesCanvas call at the bottom of main.js).
import { paginateDocument } from '@convetlib/editor';

const FIELD_MIME = 'application/x-convetlib-field';
const THUMB_WIDTH = 150;
const MAX_THUMBS = 60;

let ctx = null;
let selectedBox = null;
let selectionMode = null; // 'object' = box chosen as an object (handle), 'text' = caret placed inside its text
let activePageIndex = 0;
let pagesModel = [];
let pagesTimer = 0;
let pendingScrollSectionId = null;
let followJson = true;
let pagePinned = false; // true after a click/focus/card jump: scroll tracking must not override the page the user chose
let jsonRangeCache = { text: null, ranges: [] };

const clone = (value) => JSON.parse(JSON.stringify(value));
const pxOf = (twips) => (twips / 1440) * 96;
const round1 = (value) => Math.round(value * 10) / 10;
const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
const cssId = (value) => (window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&'));
const status = (text) => { const el = document.getElementById('status'); if (el) el.textContent = text; };
const paper = () => document.getElementById('paper');
const scroller = () => paper().closest('.canvas');
const zoomOf = () => { const z = Number.parseFloat(paper().style.zoom); return Number.isFinite(z) && z > 0 ? z : 1; };

function pageDims(page, pageSizes) {
  const size = page?.size || pageSizes.A4;
  const landscape = page?.orientation === 'landscape';
  return { w: pxOf(landscape ? size.height : size.width), h: pxOf(landscape ? size.width : size.height) };
}

/** Returns a generator of ids that never collides with any id already present in `doc`. */
function idFactory(doc) {
  const used = new Set();
  for (const section of doc.sections || []) {
    used.add(section.id);
    for (const node of ctx.allNodes([...(section.header || []), ...(section.content || []), ...(section.footer || [])])) if (node.id) used.add(node.id);
  }
  return () => { let id; do { id = ctx.ids(); } while (used.has(id)); used.add(id); return id; };
}
function findNode(doc, id) {
  return ctx.allNodes(doc.sections.flatMap((s) => [...(s.header || []), ...(s.content || []), ...(s.footer || [])])).find((node) => node.id === id);
}

// --------------------------------------------------------------------------------------------- canvas rendering

export function canvasBlockHtml(block, blockIndex) {
  const a = block.attrs || {};
  if (block.type === 'image') {
    return `<div class="doc-block image-block" data-block-id="${ctx.esc(block.id || '')}" data-block-index="${blockIndex}" draggable="false">${ctx.blockHtml(block)}</div>`;
  }
  const free = Number.isFinite(a.positionX) && Number.isFinite(a.positionY);
  const x = free ? a.positionX : 24;
  const y = free ? a.positionY : 24 + blockIndex * 30;
  const width = Number.isFinite(a.boxWidth) && a.boxWidth > 0 ? `width:${a.boxWidth}px;` : 'width:max-content;max-width:100%;';
  // The wrapper deliberately has NO data-block-id: the inner <p>/<h2> is the editable leaf the browser binding maps to the model.
  return `<div class="doc-block canvas-box" data-box-id="${ctx.esc(block.id || '')}" data-block-index="${blockIndex}" draggable="false" style="left:${x}px;top:${y}px;${width}"><span class="box-handle" contenteditable="false" title="Seret untuk memindahkan"></span>${ctx.blockHtml(block)}<span class="box-resize" contenteditable="false" title="Seret untuk mengubah lebar"></span></div>`;
}

export function canvasSheetHtml(section, sectionIndex, doc) {
  const dims = pageDims(section.page, ctx.PAGE_SIZES);
  const baseMargins = doc.sections[0]?.page?.margins || section.page.margins;
  const padLeft = pxOf(baseMargins.left);
  const blocks = (section.content || []).map((block, index) => canvasBlockHtml(block, index)).join('');
  return `<div class="canvas-sheet" data-section-index="${sectionIndex}" data-region="content" data-page-section="${ctx.esc(section.id)}" style="width:${dims.w}px;height:${dims.h}px;margin-left:-${padLeft}px"><span class="canvas-sheet-label" contenteditable="false">CANVAS · ${Math.round(dims.w)} × ${Math.round(dims.h)} px</span>${blocks}</div>`;
}

export function applyBoxSelection() {
  let found = false;
  paper().querySelectorAll('.canvas-box').forEach((el) => {
    const on = !!selectedBox && el.dataset.boxId === selectedBox;
    el.classList.toggle('is-selected-box', on);
    if (on) found = true;
  });
  if (!found) { selectedBox = null; selectionMode = null; }
}

export function clearBoxSelection() {
  selectedBox = null;
  selectionMode = null;
  applyBoxSelection();
}

// --------------------------------------------------------------------------------------------- canvas operations

function textBox(nextId, text, x, y, width) {
  const attrs = { positionX: round1(x), positionY: round1(y) };
  if (width) attrs.boxWidth = width;
  return { type: 'paragraph', id: nextId(), attrs, content: text ? [{ type: 'text', text }] : [] };
}

function appendCanvas(doc, nextId) {
  const base = clone(doc.sections[0].page);
  // A new canvas starts blank. Text boxes are created only when the user explicitly adds one,
  // so deleting a text block from DOCUMENT.JSON never leaves a misleading default text behind.
  const section = { id: nextId(), kind: 'canvas', page: base, content: [] };
  doc.sections.push(section);
  return doc.sections.length - 1;
}

function targetCanvasIndex(doc) {
  const active = pagesModel[activePageIndex];
  if (active && active.kind === 'canvas' && doc.sections[active.sectionIndex]?.kind === 'canvas') return active.sectionIndex;
  for (let i = doc.sections.length - 1; i >= 0; i--) if (doc.sections[i].kind === 'canvas') return i;
  return -1;
}

function addCanvas() {
  const doc = clone(ctx.getEditor().state.document);
  const nextId = idFactory(doc);
  const index = appendCanvas(doc, nextId);
  const id = doc.sections[index].id;
  pendingScrollSectionId = id;
  if (ctx.replaceModel(doc)) status('Canvas baru ditambahkan. Tambah kotak teks / gambar, atau seret field dari INSPECTOR.');
  else pendingScrollSectionId = null;
}

function addTextBox() {
  if (ctx.getView() !== 'preview') { status('Buka tampilan PREVIEW untuk menambah kotak teks.'); return; }
  const doc = clone(ctx.getEditor().state.document);
  const nextId = idFactory(doc);
  let index = targetCanvasIndex(doc);
  if (index < 0) {
    index = appendCanvas(doc, nextId);
    pendingScrollSectionId = doc.sections[index].id;
    if (ctx.replaceModel(doc)) status('Belum ada canvas — canvas baru dibuat dengan satu kotak teks.');
    else pendingScrollSectionId = null;
    return;
  }
  const section = doc.sections[index];
  const step = section.content.length % 8;
  section.content.push(textBox(nextId, 'Teks baru', 60 + step * 24, 90 + step * 34, 240));
  if (ctx.replaceModel(doc)) status('Kotak teks ditambahkan. Seret gagang biru di atasnya untuk memindahkan.');
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Gagal membaca gambar'));
    reader.readAsDataURL(file);
  });
}
function imageSize(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 200, h: img.naturalHeight || 120 });
    img.onerror = () => reject(new Error('Gambar tidak bisa dimuat'));
    img.src = src;
  });
}
async function addCanvasImage(file) {
  if (!file) return;
  if (ctx.getView() !== 'preview') { status('Buka tampilan PREVIEW untuk menambah gambar.'); return; }
  try {
    if (!/^image\/(png|jpeg)$/i.test(file.type)) throw new Error('Gunakan gambar PNG atau JPEG');
    if (file.size > 5 * 1024 * 1024) throw new Error('Ukuran gambar maksimal 5 MiB');
    const src = await readAsDataUrl(file);
    const natural = await imageSize(src);
    const scale = Math.min(1, 320 / natural.w);
    const doc = clone(ctx.getEditor().state.document);
    const nextId = idFactory(doc);
    let index = targetCanvasIndex(doc);
    let created = false;
    if (index < 0) { index = appendCanvas(doc, nextId); created = true; }
    const section = doc.sections[index];
    const step = section.content.length % 8;
    section.content.push({ type: 'image', id: nextId(), attrs: { src, alt: file.name, width: Math.round(natural.w * scale), height: Math.round(natural.h * scale), positionX: 60 + step * 24, positionY: 120 + step * 34 } });
    if (created) pendingScrollSectionId = section.id;
    if (ctx.replaceModel(doc)) status(`Gambar ${file.name} ditambahkan ke canvas. Seret untuk memindahkan.`);
    else pendingScrollSectionId = null;
  } catch (error) {
    status(`Gagal menambah gambar: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function moveCanvasSection(sectionId, delta) {
  const doc = clone(ctx.getEditor().state.document);
  const from = doc.sections.findIndex((section) => section.id === sectionId && section.kind === 'canvas');
  const to = from + delta;
  if (from < 0 || to < 0 || to >= doc.sections.length) { status('Canvas sudah berada di batas urutan halaman.'); return; }
  const [section] = doc.sections.splice(from, 1);
  doc.sections.splice(to, 0, section);
  pendingScrollSectionId = sectionId;
  if (ctx.replaceModel(doc)) status(`Canvas dipindahkan ke urutan section ${to + 1}.`);
  else pendingScrollSectionId = null;
}

function deleteCanvasSection(sectionId) {
  const doc = clone(ctx.getEditor().state.document);
  const index = doc.sections.findIndex((s) => s.id === sectionId && s.kind === 'canvas');
  if (index < 0) return;
  if (doc.sections.length < 2) { status('Dokumen harus punya minimal satu section.'); return; }
  if (!confirm('Hapus canvas ini beserta seluruh elemennya?')) return;
  doc.sections.splice(index, 1);
  if (ctx.replaceModel(doc)) status('Canvas dihapus.');
}

/** A section needs at least one block to stay valid; refill any emptied section with one empty paragraph. Returns true if it did. */
export function ensureSectionContent(doc) {
  const nextId = idFactory(doc);
  let filled = false;
  for (const section of doc.sections) {
    if (Array.isArray(section.content) && section.content.length === 0) {
      section.content = [{ type: 'paragraph', id: nextId(), content: [] }];
      filled = true;
    }
  }
  return filled;
}

export function deleteSelectedBox() {
  if (!selectedBox) return false;
  const doc = clone(ctx.getEditor().state.document);
  for (const section of doc.sections) {
    const index = section.content.findIndex((b) => b.id === selectedBox);
    if (index < 0) continue;
    const only = section.content.length === 1 ? section.content[0] : null;
    if (only && only.type === 'paragraph' && !(only.content || []).length) {
      selectedBox = null;
      selectionMode = null;
      applyBoxSelection();
      status('Canvas sudah kosong; tidak ada elemen lain untuk dihapus.');
      return true;
    }
    section.content.splice(index, 1);
    selectedBox = null;
    selectionMode = null;
    const emptied = ensureSectionContent(doc);
    if (ctx.replaceModel(doc)) status(emptied ? 'Elemen terakhir dihapus. Canvas dikosongkan; satu paragraf kosong dipertahankan karena model memerlukan minimal satu blok.' : 'Elemen canvas dihapus.');
    return true;
  }
  selectedBox = null;
  selectionMode = null;
  return false;
}

function writeBoxGeometry(id, patch) {
  const doc = clone(ctx.getEditor().state.document);
  const node = findNode(doc, id);
  if (!node) { status('Kotak teks tidak ditemukan di model.'); ctx.getEditor() && ctx.render(); return; }
  node.attrs = { ...(node.attrs || {}), ...patch };
  if (!ctx.replaceModel(doc)) { status('Posisi kotak ditolak validasi model.'); ctx.render(); }
}

// --------------------------------------------------------------------------------------------- box drag / resize

function setupBoxInteraction() {
  const root = paper();
  let drag = null;
  function detach() {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = (e.clientX - drag.px) / drag.zoom;
    const dy = (e.clientY - drag.py) / drag.zoom;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.px, e.clientY - drag.py) < 3) return;
      drag.moved = true;
      drag.box.classList.add('is-moving');
    }
    if (drag.mode === 'move') {
      drag.x = clamp(drag.x0 + dx, 0, drag.sheetW - Math.min(drag.w0, drag.sheetW));
      drag.y = clamp(drag.y0 + dy, 0, drag.sheetH - 24);
      drag.box.style.left = `${drag.x}px`;
      drag.box.style.top = `${drag.y}px`;
      status(`Kotak teks: X ${Math.round(drag.x)}px, Y ${Math.round(drag.y)}px`);
    } else {
      drag.w = clamp(drag.w0 + dx, 40, drag.sheetW - drag.x0);
      drag.box.style.width = `${drag.w}px`;
      drag.box.style.maxWidth = 'none';
      status(`Lebar kotak: ${Math.round(drag.w)}px`);
    }
  }
  function finish(commit) {
    const d = drag;
    if (!d) return;
    drag = null;
    detach();
    d.box.classList.remove('is-moving');
    try { if (d.handle.hasPointerCapture(d.pointerId)) d.handle.releasePointerCapture(d.pointerId); } catch { /* ignore */ }
    if (!d.moved) return;
    if (!commit) { ctx.render(); status('Perubahan kotak dibatalkan'); return; }
    if (d.mode === 'move') writeBoxGeometry(d.id, { positionX: round1(d.x), positionY: round1(d.y) });
    else writeBoxGeometry(d.id, { boxWidth: Math.round(d.w) });
  }
  function onUp() { finish(true); }
  function onCancel() { finish(Boolean(drag && drag.moved)); }
  function onKey(e) { if (e.key === 'Escape') finish(false); }

  root.addEventListener('pointerdown', (event) => {
    if (ctx.getView() !== 'preview' || event.button !== 0 || drag) return;
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    if (!target) return;
    const box = target.closest('.canvas-box');
    if (!box) {
      if (selectedBox) { selectedBox = null; selectionMode = null; applyBoxSelection(); }
      return;
    }
    selectedBox = box.dataset.boxId;
    ctx.clearImageSelection();
    applyBoxSelection();
    const handle = target.closest('.box-handle, .box-resize');
    if (!handle) { selectionMode = 'text'; return; } // plain click inside the text: let the browser place the caret
    selectionMode = 'object';
    // The box is selected as an object, not edited: drop the text caret so Delete/Backspace act on the object.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.getSelection()?.removeAllRanges();
    event.preventDefault();
    const sheet = box.closest('.canvas-sheet');
    const zoom = zoomOf();
    const boxRect = box.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId, box, handle, id: box.dataset.boxId, mode: handle.classList.contains('box-resize') ? 'resize' : 'move',
      zoom, px: event.clientX, py: event.clientY, moved: false,
      x0: Number.parseFloat(box.style.left) || 0, y0: Number.parseFloat(box.style.top) || 0, w0: boxRect.width / zoom,
      sheetW: sheet ? sheet.offsetWidth : 600, sheetH: sheet ? sheet.offsetHeight : 800,
    };
    drag.x = drag.x0; drag.y = drag.y0; drag.w = drag.w0;
    try { handle.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
  });
}

// --------------------------------------------------------------------------------------------- INSPECTOR field drag & drop

export function fieldGrip() {
  const grip = document.createElement('span');
  grip.className = 'field-grip';
  grip.textContent = '⠿';
  grip.setAttribute('aria-hidden', 'true');
  return grip;
}

export function makeFieldDraggable(row, key) {
  row.draggable = true;
  row.title = 'Seret ke canvas atau paragraf untuk menyisipkan placeholder';
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(FIELD_MIME, key);
    e.dataTransfer.setData('text/plain', `{{${key}}}`);
    row.classList.add('is-field-dragging');
  });
  row.addEventListener('dragend', () => { row.classList.remove('is-field-dragging'); clearFieldDropTargets(); });
}

function isFieldDrag(e) { return Array.from(e.dataTransfer?.types || []).includes(FIELD_MIME); }
function clearFieldDropTargets() { paper().querySelectorAll('.field-drop-target').forEach((el) => el.classList.remove('field-drop-target')); }
function elementOf(target) { return target instanceof Element ? target : target?.parentElement || null; }

function caretFromPoint(x, y) {
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null; }
  if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); return r ? { node: r.startContainer, offset: r.startOffset } : null; }
  return null;
}

/** DOM point -> model offset inside one text block. Inline atoms (placeholders) and <br> count as 1, text counts by length. */
function modelOffsetIn(root, node, offset) {
  const unit = (n) => {
    if (n.nodeType === Node.TEXT_NODE) return n.nodeValue.length;
    if (n.nodeType !== Node.ELEMENT_NODE) return 0;
    if (n.hasAttribute('data-inline-atom') || n.tagName === 'BR') return 1;
    return Array.from(n.childNodes).reduce((sum, child) => sum + unit(child), 0);
  };
  if (!node || !root.contains(node) && node !== root) return null;
  if (node === root) return Array.from(root.childNodes).slice(0, offset).reduce((sum, child) => sum + unit(child), 0);
  let total = 0;
  let found = false;
  const walk = (el) => {
    for (const child of Array.from(el.childNodes)) {
      if (found) return;
      if (child === node) {
        if (child.nodeType === Node.TEXT_NODE) total += offset;
        else if (!child.hasAttribute?.('data-inline-atom')) total += Array.from(child.childNodes).slice(0, offset).reduce((sum, c) => sum + unit(c), 0);
        found = true;
        return;
      }
      if (child.nodeType === Node.ELEMENT_NODE && child.contains(node)) {
        if (child.hasAttribute('data-inline-atom')) { found = true; return; } // caret inside a placeholder chip: insert before it
        walk(child);
        return;
      }
      total += unit(child);
    }
  };
  walk(root);
  return found ? total : null;
}

function insertInline(block, offset, inline) {
  const out = [];
  let pos = 0;
  let done = false;
  for (const node of block.content || []) {
    const len = node.type === 'text' ? node.text.length : 1;
    if (!done && node.type === 'text' && offset > pos && offset < pos + len) {
      const cut = offset - pos;
      const marks = node.marks ? { marks: clone(node.marks) } : {};
      out.push({ type: 'text', text: node.text.slice(0, cut), ...marks }, inline, { type: 'text', text: node.text.slice(cut), ...(node.marks ? { marks: clone(node.marks) } : {}) });
      done = true;
    } else {
      if (!done && offset <= pos) { out.push(inline); done = true; }
      out.push(node);
    }
    pos += len;
  }
  if (!done) out.push(inline);
  block.content = out;
}

function dropFieldAt(key, e) {
  const doc = clone(ctx.getEditor().state.document);
  const el = elementOf(e.target);
  if (!el) return;
  const placeholder = { type: 'placeholder', attrs: { key } };
  const textEl = el.closest('p[data-block-id], h2[data-block-id]');
  const sheet = el.closest('.canvas-sheet');

  if (textEl) {
    const block = findNode(doc, textEl.dataset.blockId);
    if (!block || !['paragraph', 'heading', 'codeBlock'].includes(block.type) || (block.content || []).some((c) => c.id)) { status('Blok ini tidak bisa menerima placeholder.'); return; }
    let offset = null;
    const caret = caretFromPoint(e.clientX, e.clientY);
    if (caret && (textEl === caret.node || textEl.contains(caret.node))) offset = modelOffsetIn(textEl, caret.node, caret.offset);
    if (offset === null) offset = (block.content || []).reduce((sum, n) => sum + (n.type === 'text' ? n.text.length : 1), 0);
    insertInline(block, offset, placeholder);
    if (ctx.replaceModel(doc)) status(`Placeholder {{${key}}} disisipkan pada posisi kursor drop.`);
    return;
  }
  if (sheet) {
    const sectionIndex = Number(sheet.dataset.sectionIndex);
    const section = doc.sections[sectionIndex];
    if (!section) return;
    const zoom = zoomOf();
    const rect = sheet.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / zoom, 0, sheet.offsetWidth - 90);
    const y = clamp((e.clientY - rect.top) / zoom, 0, sheet.offsetHeight - 30);
    const nextId = idFactory(doc);
    const box = textBox(nextId, '', x, y, 0);
    box.content = [placeholder];
    section.content.push(box);
    if (ctx.replaceModel(doc)) status(`Placeholder {{${key}}} diletakkan di canvas (X ${Math.round(x)}px, Y ${Math.round(y)}px).`);
    return;
  }
  status('Jatuhkan field di atas teks paragraf, atau di atas halaman Canvas. Buat canvas lewat panel Pages.');
}

function setupFieldDrop() {
  const root = paper();
  root.addEventListener('dragover', (e) => {
    if (!isFieldDrag(e) || ctx.getView() !== 'preview') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const el = elementOf(e.target);
    const textEl = el?.closest('p[data-block-id], h2[data-block-id]');
    const sheet = el?.closest('.canvas-sheet');
    clearFieldDropTargets();
    if (textEl) textEl.classList.add('field-drop-target');
    else if (sheet) sheet.classList.add('field-drop-target');
  });
  root.addEventListener('dragleave', (e) => {
    if (!isFieldDrag(e)) return;
    if (!e.relatedTarget || !root.contains(e.relatedTarget)) clearFieldDropTargets();
  });
  root.addEventListener('drop', (e) => {
    if (!isFieldDrag(e) || ctx.getView() !== 'preview') return;
    e.preventDefault(); // also stops the browser from inserting the raw "{{key}}" text into the contenteditable root
    e.stopPropagation();
    const key = e.dataTransfer.getData(FIELD_MIME);
    clearFieldDropTargets();
    if (key) dropFieldAt(key, e);
  });
}

// --------------------------------------------------------------------------------------------- DOCUMENT.JSON follows the active page

/** Character ranges of every top-level section object inside JSON.stringify(doc, null, 2). Cached per text. */
function sectionRanges(text) {
  if (jsonRangeCache.text === text) return jsonRangeCache.ranges;
  const ranges = [];
  const key = '\n  "sections": [';
  const k = text.indexOf(key);
  if (k >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let start = -1;
    for (let i = k + key.length - 1; i < text.length; i++) { // begins on the '[' of the sections array
      const ch = text[i];
      if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{' || ch === '[') { depth++; if (ch === '{' && depth === 2) start = i; }
      else if (ch === '}' || ch === ']') {
        if (ch === '}' && depth === 2 && start >= 0) { ranges.push({ start, end: i + 1 }); start = -1; }
        depth--;
        if (depth === 0) break;
      }
    }
  }
  jsonRangeCache = { text, ranges };
  return ranges;
}

function lineIndexAt(text, offset) {
  let line = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

/**
 * Scrolls DOCUMENT.JSON to the section of the active page. Never moves the JSON while the user is typing in it
 * (unless forced), and never touches the caret or selection. `manual` bypasses the "follow" toggle.
 */
export function syncJsonToActiveSection(options = {}) {
  const el = document.getElementById('json');
  const info = document.getElementById('jsonFollowInfo');
  if (!el) return;
  const pg = pagesModel[activePageIndex];
  if (!pg) { if (info) info.textContent = '-'; return; }
  const text = el.value;
  const range = sectionRanges(text)[pg.sectionIndex];
  const line = range ? lineIndexAt(text, range.start) : -1;
  if (info) info.textContent = range ? `Halaman ${activePageIndex + 1} (${pg.kind === 'canvas' ? 'canvas' : 'alur'}) \u00b7 sections[${pg.sectionIndex}] \u00b7 baris ${line + 1}` : `Halaman ${activePageIndex + 1} \u00b7 section tidak ditemukan di JSON`;
  if (!range || (!followJson && !options.manual)) return;
  if (document.activeElement === el && !options.manual) return; // do not yank the view while the user edits the JSON
  if (!el.clientHeight) return; // hidden tab: the next time the JSON tab opens we sync again
  const lines = (text.match(/\n/g) || []).length + 1;
  const cs = getComputedStyle(el);
  const lineHeight = (el.scrollHeight - (Number.parseFloat(cs.paddingTop) || 0) - (Number.parseFloat(cs.paddingBottom) || 0)) / lines;
  el.scrollTop = Math.max(0, (line - 1) * lineHeight);
  el.scrollLeft = 0;
}

// --------------------------------------------------------------------------------------------- pages panel

export function schedulePagesRefresh() {
  clearTimeout(pagesTimer);
  pagesTimer = setTimeout(refreshPages, 120);
}

function pageAnchor(pg) {
  const root = paper();
  if (pg.kind === 'canvas') return root.querySelector(`.canvas-sheet[data-page-section="${cssId(pg.sectionId)}"]`);
  const first = pg.blockIds[0];
  return first ? root.querySelector(`.doc-block[data-block-id="${cssId(first)}"]`) : null;
}

function measureFlowBlocks() {
  const heights = new Map();
  const zoom = zoomOf();
  paper().querySelectorAll('.document-block-list[data-region="content"]').forEach((list) => {
    const blocks = Array.from(list.children).filter((el) => el.classList.contains('doc-block'));
    const listBottom = list.getBoundingClientRect().bottom;
    blocks.forEach((el, i) => {
      const top = el.getBoundingClientRect().top;
      const bottom = i + 1 < blocks.length ? blocks[i + 1].getBoundingClientRect().top : listBottom;
      heights.set(el.dataset.blockId, Math.max(0, Math.round(((bottom - top) / zoom) * 15))); // px -> twips
    });
  });
  return heights;
}

function computePages(doc) {
  const flowSections = [];
  doc.sections.forEach((section) => {
    if (section.kind === 'canvas') return;
    const page = section.page;
    const landscape = page.orientation === 'landscape';
    flowSections.push({ ...section, page: { ...page, size: landscape ? { width: page.size.height, height: page.size.width } : page.size } });
  });
  let result = { pages: [] };
  if (flowSections.length) {
    const heights = measureFlowBlocks();
    try { result = paginateDocument({ ...doc, sections: flowSections }, (block) => heights.get(block.id) ?? 400); }
    catch (error) { status(`Pagination gagal: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const model = [];
  doc.sections.forEach((section, sectionIndex) => {
    if (section.kind === 'canvas') {
      model.push({ kind: 'canvas', sectionIndex, sectionId: section.id, blockIds: (section.content || []).map((b) => b.id), overflow: false });
      return;
    }
    const pages = result.pages.filter((p) => p.sectionId === section.id);
    if (!pages.length) model.push({ kind: 'flow', sectionIndex, sectionId: section.id, blockIds: [], overflow: false });
    for (const p of pages) model.push({ kind: 'flow', sectionIndex, sectionId: section.id, blockIds: p.blocks.map((b) => b.blockId), overflow: p.overflow, used: p.usedHeight, capacity: p.contentHeight });
  });
  return model;
}

function thumbFor(pg, doc) {
  const section = doc.sections[pg.sectionIndex];
  const dims = pageDims(section.page, ctx.PAGE_SIZES);
  const scale = THUMB_WIDTH / dims.w;
  const thumb = document.createElement('div');
  thumb.className = 'page-thumb';
  thumb.style.width = `${THUMB_WIDTH}px`;
  thumb.style.height = `${Math.round(dims.h * scale)}px`;
  const inner = document.createElement('div');
  inner.className = 'page-thumb-inner';
  inner.style.width = `${dims.w}px`;
  inner.style.height = `${dims.h}px`;
  inner.style.transform = `scale(${scale})`;
  const strip = (node) => {
    node.removeAttribute?.('data-block-id'); node.removeAttribute?.('data-box-id'); node.removeAttribute?.('draggable'); node.removeAttribute?.('contenteditable');
    node.querySelectorAll?.('[data-block-id],[data-box-id],[draggable],[contenteditable]').forEach((el) => { el.removeAttribute('data-block-id'); el.removeAttribute('data-box-id'); el.removeAttribute('draggable'); el.removeAttribute('contenteditable'); });
  };
  if (pg.kind === 'canvas') {
    const sheet = pg.anchor;
    if (sheet) { const copy = sheet.cloneNode(true); strip(copy); copy.style.margin = '0'; copy.style.outline = '0'; inner.append(copy); }
  } else {
    const m = section.page.margins;
    inner.style.boxSizing = 'border-box';
    inner.style.padding = `${pxOf(m.top)}px ${pxOf(m.right)}px ${pxOf(m.bottom)}px ${pxOf(m.left)}px`;
    for (const id of pg.blockIds) {
      const el = paper().querySelector(`.doc-block[data-block-id="${cssId(id)}"]`);
      if (el) { const copy = el.cloneNode(true); strip(copy); inner.append(copy); }
    }
  }
  thumb.append(inner);
  return thumb;
}

function renderPageList(doc) {
  const list = document.getElementById('pageList');
  list.innerHTML = '';
  pagesModel.forEach((pg, i) => {
    const card = document.createElement('div');
    card.className = `page-card${i === activePageIndex ? ' is-active' : ''}`;
    card.dataset.pageIndex = String(i);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Halaman ${i + 1}`);
    const head = document.createElement('div');
    head.className = 'page-card-head';
    head.innerHTML = `<b>Halaman ${i + 1}</b><span class="page-badge${pg.kind === 'canvas' ? ' canvas' : ''}">${pg.kind === 'canvas' ? 'CANVAS' : 'ALUR'}</span>`;
    if (pg.kind === 'canvas') {
      const actions = document.createElement('span');
      actions.className = 'page-card-actions';
      const up = document.createElement('button');
      up.type = 'button'; up.className = 'page-card-move'; up.textContent = '\u2191'; up.title = 'Pindahkan canvas ke urutan sebelumnya'; up.setAttribute('aria-label', `Pindahkan canvas halaman ${i + 1} ke atas`); up.disabled = pg.sectionIndex <= 0;
      up.addEventListener('click', (ev) => { ev.stopPropagation(); moveCanvasSection(pg.sectionId, -1); });
      const down = document.createElement('button');
      down.type = 'button'; down.className = 'page-card-move'; down.textContent = '\u2193'; down.title = 'Pindahkan canvas ke urutan berikutnya'; down.setAttribute('aria-label', `Pindahkan canvas halaman ${i + 1} ke bawah`); down.disabled = pg.sectionIndex >= doc.sections.length - 1;
      down.addEventListener('click', (ev) => { ev.stopPropagation(); moveCanvasSection(pg.sectionId, 1); });
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'page-card-del'; del.textContent = 'Hapus'; del.setAttribute('aria-label', `Hapus canvas halaman ${i + 1}`);
      del.addEventListener('click', (ev) => { ev.stopPropagation(); deleteCanvasSection(pg.sectionId); });
      actions.append(up, down, del); head.append(actions);
    }
    card.append(head);
    if (i < MAX_THUMBS) card.append(thumbFor(pg, doc));
    const meta = document.createElement('div');
    meta.className = 'page-card-meta';
    meta.textContent = pg.kind === 'canvas' ? `${pg.blockIds.length} elemen` : `${pg.blockIds.length} blok${pg.overflow ? ' · melebihi halaman' : ''}`;
    card.append(meta);
    const go = () => goToPage(i);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    list.append(card);
  });
}

function goToPage(index) {
  const pg = pagesModel[index];
  if (!pg) return;
  pagePinned = true;
  const anchor = pg.anchor || pageAnchor(pg);
  const area = scroller();
  if (index === 0 && pg.kind === 'flow') area.scrollTo({ top: 0, behavior: 'smooth' });
  else if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setActivePage(index);
}

function setActivePage(index) {
  activePageIndex = index;
  syncJsonToActiveSection();
  document.querySelectorAll('#pageList .page-card').forEach((card) => card.classList.toggle('is-active', Number(card.dataset.pageIndex) === index));
  const indicator = document.getElementById('pageIndicator');
  if (indicator) indicator.textContent = `Hal. ${Math.min(index + 1, Math.max(1, pagesModel.length))}/${Math.max(1, pagesModel.length)}`;
}

function trackActivePage() {
  if (!pagesModel.length || pagePinned) return;
  const limit = scroller().getBoundingClientRect().top + 80;
  let index = 0;
  pagesModel.forEach((pg, i) => { const a = pg.anchor; if (a && a.getBoundingClientRect().top <= limit) index = i; });
  if (index !== activePageIndex) setActivePage(index);
}

function refreshPages() {
  pagesTimer = 0;
  if (!ctx || ctx.getView() !== 'preview') return;
  const doc = ctx.getEditor().state.document;
  const root = paper();
  root.querySelectorAll('.page-marker').forEach((el) => el.remove());
  pagesModel = computePages(doc);
  pagesModel.forEach((pg) => { pg.anchor = pageAnchor(pg); });
  // Visible page boundaries inside the preview (flow pages only; canvas pages are separate sheets).
  pagesModel.forEach((pg, i) => {
    if (i === 0 || pg.kind !== 'flow' || !pg.anchor) return;
    const marker = document.createElement('div');
    marker.className = 'page-marker';
    marker.setAttribute('contenteditable', 'false');
    marker.textContent = `HALAMAN ${i + 1}`;
    pg.anchor.before(marker);
  });
  if (activePageIndex >= pagesModel.length) activePageIndex = Math.max(0, pagesModel.length - 1);
  const canvasCount = pagesModel.filter((p) => p.kind === 'canvas').length;
  document.getElementById('pagecount').textContent = String(pagesModel.length);
  document.getElementById('pageSummary').textContent = `${pagesModel.length} halaman${canvasCount ? ` · ${canvasCount} canvas` : ''}`;
  if (!document.getElementById('leftPages').hidden) renderPageList(doc);
  setActivePage(activePageIndex);
  if (pendingScrollSectionId) {
    const index = pagesModel.findIndex((p) => p.sectionId === pendingScrollSectionId);
    pendingScrollSectionId = null;
    if (index >= 0) goToPage(index);
  }
}

// --------------------------------------------------------------------------------------------- wiring

export function initPagesCanvas(context) {
  ctx = context;
  document.querySelectorAll('[data-left]').forEach((button) => button.addEventListener('click', () => {
    const name = button.dataset.left;
    document.querySelectorAll('[data-left]').forEach((b) => b.classList.toggle('selected', b === button));
    document.getElementById('leftJson').hidden = name !== 'json';
    document.getElementById('leftPages').hidden = name !== 'pages';
    if (name === 'pages') refreshPages();
    if (name === 'json') requestAnimationFrame(() => syncJsonToActiveSection());
  }));
  document.getElementById('addCanvas').addEventListener('click', addCanvas);
  document.getElementById('addBox').addEventListener('click', addTextBox);
  document.getElementById('addCanvasImage').addEventListener('click', () => document.getElementById('canvasImageFile').click());
  document.getElementById('canvasImageFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    try { await addCanvasImage(file); } finally { e.target.value = ''; }
  });
  let scrollRaf = 0;
  scroller().addEventListener('scroll', () => { if (scrollRaf) return; scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; trackActivePage(); }); }, { passive: true });
  setupBoxInteraction();
  // Interacting with a page (click / keyboard focus) makes it the active one, so DOCUMENT.JSON follows it.
  const activateFromEvent = (event) => {
    if (ctx.getView() !== 'preview') return;
    const holder = elementOf(event.target)?.closest('[data-section-index]');
    if (!holder) return;
    const sectionIndex = Number(holder.dataset.sectionIndex);
    pagePinned = true;
    if (pagesModel[activePageIndex]?.sectionIndex === sectionIndex) return;
    const index = pagesModel.findIndex((pg) => pg.sectionIndex === sectionIndex);
    if (index >= 0) setActivePage(index);
  };
  paper().addEventListener('pointerdown', activateFromEvent, true);
  paper().addEventListener('focusin', activateFromEvent);
  // A deliberate scroll by the user (wheel, touch, scrollbar) releases the pin so the active page follows the viewport again.
  const unpin = () => { pagePinned = false; };
  scroller().addEventListener('wheel', unpin, { passive: true });
  scroller().addEventListener('touchmove', unpin, { passive: true });
  scroller().addEventListener('pointerdown', (event) => { if (event.target === scroller()) unpin(); }, true);
  const followBox = document.getElementById('jsonFollow');
  followBox?.addEventListener('change', () => { followJson = followBox.checked; if (followJson) syncJsonToActiveSection({ manual: true }); });
  document.getElementById('jsonFollowNow')?.addEventListener('click', () => syncJsonToActiveSection({ manual: true }));
  // Delete / Backspace removes the selected canvas object (text box or image). A box counts as selected-as-object when it
  // was chosen with its handle (selectionMode 'object') and an image when it was clicked; while the caret is inside text
  // (selectionMode 'text') the keys keep editing the text. Form fields and the JSON editor are never intercepted.
  document.addEventListener('keydown', (event) => {
    if (ctx.getView() !== 'preview' || !['Delete', 'Backspace'].includes(event.key)) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    const target = elementOf(event.target);
    if (target?.closest('input, textarea, select, [role="textbox"]')) return;
    if (selectedBox && selectionMode === 'object') {
      event.preventDefault();
      event.stopPropagation();
      deleteSelectedBox();
      return;
    }
    if (!selectedBox && ctx.hasSelectedImage()) {
      event.preventDefault();
      event.stopPropagation();
      ctx.deleteSelectedImage();
    }
  }, true);
  setupFieldDrop();
}
