// Pages panel, manual-design canvas and INSPECTOR field drag & drop for the Convetlib playground.
// Kept in its own module so main.js only wires it in (see initPagesCanvas call at the bottom of main.js).
import { paginateDocument } from '@convetlib/editor';
import { planCanvasImport, createIdAllocator, cloneSectionWithFreshIds } from './canvas-import.js';

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
let copiedCanvasContent = null;

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
  const free = Number.isFinite(a.positionX) && Number.isFinite(a.positionY);
  if (block.type === 'image') {
    const free = Number.isFinite(a.positionX) && Number.isFinite(a.positionY);
    if (!free) {
      // Imported/inline images participate in normal document flow; do not invent absolute coordinates.
      return '<div class="doc-block image-block canvas-flow-block" data-block-id="' + ctx.esc(block.id || '') + '" data-block-index="' + blockIndex + '" draggable="' + (block.id ? 'true' : 'false') + '">' + ctx.blockHtml(block) + '</div>';
    }
    const imageAttrs = { ...(block.attrs || {}) };
    delete imageAttrs.positionX;
    delete imageAttrs.positionY;
    const imageBlock = { ...block, attrs: imageAttrs };
    return '<div class="doc-block image-block canvas-image-box" data-block-id="' + ctx.esc(block.id || '') + '" data-block-index="' + blockIndex + '" draggable="' + (block.id ? 'true' : 'false') + '" style="position:absolute;left:' + a.positionX + 'px;top:' + a.positionY + 'px;width:max-content;max-width:100%;">' + ctx.blockHtml(imageBlock) + '</div>';
  }
  if (!free && block.type === 'horizontalRule') {
    // A line stays in flow until the user moves it; its geometry is then saved to the document model.
    return '<div class="doc-block canvas-flow-block canvas-line-flow" data-box-id="' + ctx.esc(block.id || '') + '" data-block-id="' + ctx.esc(block.id || '') + '" data-block-index="' + blockIndex + '" draggable="' + (block.id ? 'true' : 'false') + '"><span class="box-handle flow-box-handle" contenteditable="false" title="Drag to move line"></span><span class="box-rotate flow-rotate-handle" contenteditable="false" title="Drag to rotate line"></span>' + ctx.blockHtml(block) + '</div>';
  }
  if (!free) {
    // Ordinary paragraphs behave like Word: they use the page's text area and flow naturally.
    // Keep the editable leaf's data-block-id intact for the browser-to-model binding.
    return '<div class="doc-block canvas-flow-block" data-box-id="' + ctx.esc(block.id || '') + '" data-block-id="' + ctx.esc(block.id || '') + '" data-block-index="' + blockIndex + '" draggable="' + (block.id ? 'true' : 'false') + '"><span class="box-handle flow-box-handle" contenteditable="false" title="Drag to move text block"></span>' + ctx.blockHtml(block) + '</div>';
  }
  const x = a.positionX;
  const y = a.positionY;
  const width = Number.isFinite(a.boxWidth) && a.boxWidth > 0 ? 'width:' + a.boxWidth + 'px;' : 'width:max-content;max-width:100%;';
  const rotation = Number.isFinite(a.rotation) ? a.rotation : 0;
  const line = block.type === 'horizontalRule';
  return '<div class="doc-block canvas-box' + (line ? ' canvas-line-box' : '') + '" data-box-id="' + ctx.esc(block.id || '') + '" data-block-id="' + ctx.esc(block.id || '') + '" data-block-index="' + blockIndex + '" data-rotation="' + rotation + '" draggable="' + (block.id ? 'true' : 'false') + '" style="left:' + x + 'px;top:' + y + 'px;' + width + 'transform:rotate(' + rotation + 'deg);"><span class="box-handle" contenteditable="false" title="Drag to move"></span>' + ctx.blockHtml(block) + (line ? '<span class="box-rotate" contenteditable="false" title="Drag to rotate line"></span>' : '<span class="box-resize" contenteditable="false" title="Drag to resize"></span>') + '</div>';
}

export function canvasSheetHtml(section, sectionIndex, doc) {
  const dims = pageDims(section.page, ctx.PAGE_SIZES);
  const margins = section.page?.margins || doc.sections[0]?.page?.margins || {};
  const left = pxOf(Number.isFinite(margins.left) ? margins.left : 1440);
  const right = pxOf(Number.isFinite(margins.right) ? margins.right : 1440);
  const top = pxOf(Number.isFinite(margins.top) ? margins.top : 1440);
  const bottom = pxOf(Number.isFinite(margins.bottom) ? margins.bottom : 1440);
  const renderRegion = (nodes) => {
    const flow = [];
    const positioned = [];
    (nodes || []).forEach((block, index) => {
      if (!(block.type === 'image' && Number.isFinite(block.attrs?.positionX) && Number.isFinite(block.attrs?.positionY)) &&
          !(Number.isFinite(block.attrs?.positionX) && Number.isFinite(block.attrs?.positionY))) {
        flow.push(canvasBlockHtml(block, index));
      } else {
        positioned.push(canvasBlockHtml(block, index));
      }
    });
    return { flow: flow.join(''), positioned: positioned.join('') };
  };
  const headerNodes = section.header || [];
  const header = renderRegion(headerNodes);
  const body = renderRegion(section.content || []);
  const footer = renderRegion(section.footer || []);
  const headerLayout = headerNodes.reduce((layout, block) => {
    const a = block.attrs || {};
    if (Number.isFinite(a.positionY)) {
      const height = Number.isFinite(a.height) && a.height > 0 ? a.height : 0;
      layout.positionedBottom = Math.max(layout.positionedBottom, a.positionY + height + 4);
    } else if (block.type === 'image') {
      layout.flowHeight += Number.isFinite(a.height) && a.height > 0 ? a.height : 60;
    } else {
      layout.flowHeight += block.type === 'table' ? Math.max(24, (block.content || []).length * 20) : 20;
    }
    return layout;
  }, { positionedBottom: 0, flowHeight: 0 });
  const headerHeight = Math.max(30, top - 20, headerLayout.positionedBottom, headerLayout.flowHeight);
  const hasHeaderContent = headerNodes.length > 0;
  // Keep empty headers visually blank. Imported horizontalRule nodes render as actual movable lines.
  const headerStyle = 'height:' + headerHeight + 'px;';
  const firstCanvasIndex = doc.sections.findIndex((item) => item.kind === 'canvas');
  const firstCanvasClass = sectionIndex === firstCanvasIndex ? ' is-first-canvas-sheet' : '';
  return '<div class="canvas-sheet' + firstCanvasClass + '" data-orientation="' + (section.page?.orientation === 'landscape' ? 'landscape' : 'portrait') + '" data-section-index="' + sectionIndex + '" data-region="content" data-page-section="' + ctx.esc(section.id) + '" style="width:' + dims.w + 'px;height:' + dims.h + 'px;--canvas-margin-left:' + left + 'px;--canvas-margin-right:' + right + 'px;--canvas-margin-top:' + top + 'px;--canvas-margin-bottom:' + bottom + 'px">' +
    '<div class="canvas-header-layer" data-section-index="' + sectionIndex + '" data-region="header" aria-label="Header halaman" style="' + headerStyle + '">' + header.flow + header.positioned + '</div>' +
    '<div class="canvas-flow-layer" data-section-index="' + sectionIndex + '" data-region="content">' + body.flow + '</div>' + body.positioned +
    '<div class="canvas-footer-layer" data-section-index="' + sectionIndex + '" data-region="footer" aria-label="Footer halaman">' + footer.flow + footer.positioned + '</div></div>';
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
  // The document schema requires at least one block per section. Keep a truly blank paragraph
  // (no text) so the canvas is visually empty but still passes model validation.
  const section = { id: nextId(), kind: 'canvas', page: base, content: [{ type: 'paragraph', id: nextId(), content: [] }] };
  doc.sections.push(section);
  return doc.sections.length - 1;
}

export function mergeImportIntoActiveCanvas(importedDoc) {
  const current = ctx.getEditor()?.state?.document;
  if (!current || !Array.isArray(importedDoc?.sections)) return null;
  const active = pagesModel[activePageIndex];
  if (!active || active.kind !== 'canvas') return null;

  const plan = planCanvasImport(current, importedDoc, active.sectionId, ctx.ids);
  if (!plan) return null;
  pendingScrollSectionId = plan.targetSectionId;
  return plan.doc;
}

function targetCanvasIndex(doc) {
  const active = pagesModel[activePageIndex];
  if (active && active.kind === 'canvas' && doc.sections[active.sectionIndex]?.kind === 'canvas') return active.sectionIndex;
  for (let i = doc.sections.length - 1; i >= 0; i--) if (doc.sections[i].kind === 'canvas') return i;
  return -1;
}

function cloneCanvasNodeWithFreshIds(node, nextId) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return null;
  const copy = { ...clone(node), id: nextId() };
  if (Array.isArray(node.content)) copy.content = node.content.map(child => child && typeof child.id === 'string' ? cloneCanvasNodeWithFreshIds(child, nextId) : clone(child));
  return copy;
}

function copyCanvasContent(sectionId) {
  const doc = ctx.getEditor()?.state?.document;
  const source = doc?.sections?.find(section => section.id === sectionId && section.kind === 'canvas');
  if (!source) { status('Canvas sumber tidak ditemukan.'); return; }
  const content = (source.content || []).filter(node => !(node.type === 'paragraph' && !(node.content || []).length && (source.content || []).length === 1));
  if (!content.length) { status('Canvas sumber belum memiliki konten untuk disalin.'); return; }
  const sourceDims = pageDims(source.page, ctx.PAGE_SIZES);
  copiedCanvasContent = { sourceId: source.id, sourceWidth: sourceDims.w, sourceHeight: sourceDims.h, nodes: clone(content) };
  status(`Isi ${content.length} elemen dari canvas berhasil disalin. Pilih canvas tujuan lalu klik “Tempel isi tersalin”.`);
  const paste = document.getElementById('pasteCanvasContent');
  const toolbarPaste = document.getElementById('pasteActiveCanvas');
  if (paste) paste.disabled = false;
  if (toolbarPaste) toolbarPaste.disabled = false;
  refreshPages();
}

function pasteCopiedCanvasContent() {
  if (!copiedCanvasContent?.nodes?.length) { status('Belum ada isi canvas yang disalin.'); return; }
  const doc = clone(ctx.getEditor().state.document);
  const targetIndex = targetCanvasIndex(doc);
  if (targetIndex < 0) { status('Pilih atau buat canvas tujuan terlebih dahulu.'); return; }
  const target = doc.sections[targetIndex];
  if (target.id === copiedCanvasContent.sourceId) { status('Pilih canvas lain sebagai tujuan agar konten tidak terduplikasi pada sumber.'); return; }
  const nextId = idFactory(doc);
  const targetDims = pageDims(target.page, ctx.PAGE_SIZES);
  const scaleX = targetDims.w / (copiedCanvasContent.sourceWidth || targetDims.w);
  const scaleY = targetDims.h / (copiedCanvasContent.sourceHeight || targetDims.h);
  const pasted = copiedCanvasContent.nodes.map(node => cloneCanvasNodeWithFreshIds(node, nextId));
  if (pasted.some(node => !node)) { status('Sebagian konten tidak dapat disalin karena struktur tidak dikenali.'); return; }
  // Adapt saved page-pixel geometry to the destination page and stagger repeated pastes.
  const existing = target.content || [];
  const offset = Math.min(8, existing.length) * 12;
  for (const node of pasted) {
    const attrs = node.attrs || (node.attrs = {});
    if (Number.isFinite(attrs.positionX)) attrs.positionX = round1(clamp(attrs.positionX * scaleX + offset, 0, Math.max(0, targetDims.w - 24)));
    if (Number.isFinite(attrs.positionY)) attrs.positionY = round1(clamp(attrs.positionY * scaleY + offset, 0, Math.max(0, targetDims.h - 24)));
    if (Number.isFinite(attrs.boxWidth)) attrs.boxWidth = round1(clamp(attrs.boxWidth * scaleX, 40, targetDims.w));
    if (node.type === 'image') {
      if (Number.isFinite(attrs.width)) attrs.width = round1(clamp(attrs.width * scaleX, 24, targetDims.w));
      if (Number.isFinite(attrs.height)) attrs.height = round1(clamp(attrs.height * scaleY, 24, targetDims.h));
    }
  }
  const isBlank = (target.content || []).length === 1 && target.content[0]?.type === 'paragraph' && !(target.content[0].content || []).length;
  target.content = [...(isBlank ? [] : (target.content || [])), ...pasted];
  pendingScrollSectionId = target.id;
  if (ctx.replaceModel(doc)) {
    status(`${pasted.length} elemen berhasil ditempel ke canvas tujuan. Konten yang sudah ada tetap dipertahankan.`);
    refreshPages();
  } else pendingScrollSectionId = null;
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
  const index = doc.sections.findIndex((s) => s.id === sectionId);
  if (index < 0) return;
  if (doc.sections.length < 2) { status('Dokumen harus menyisakan minimal satu halaman. Halaman terakhir dapat dikosongkan, tetapi tidak dapat dihapus seluruhnya.'); return; }
  const section = doc.sections[index];
  if (!confirm('Hapus halaman ' + (section.kind === 'canvas' ? 'Canvas' : 'dokumen') + ' ini beserta seluruh elemennya?')) return;
  doc.sections.splice(index, 1);
  if (ctx.replaceModel(doc)) status('Halaman dihapus. Halaman bawaan kosong tidak wajib dipertahankan.');
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
      drag.y = clamp(drag.y0 + dy, 0, drag.sheetH - 12);
      drag.box.style.left = String(drag.x) + 'px';
      drag.box.style.top = String(drag.y) + 'px';
      status('Garis/objek: X ' + Math.round(drag.x) + 'px, Y ' + Math.round(drag.y) + 'px');
    } else if (drag.mode === 'rotate') {
      const rect = drag.box.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
      drag.rotation = Math.round(drag.rotation0 + angle - drag.pointerAngle);
      drag.box.style.transform = 'rotate(' + drag.rotation + 'deg)';
      status('Rotasi garis: ' + drag.rotation + 'deg');
    } else {
      drag.w = clamp(drag.w0 + dx, 40, drag.sheetW - drag.x0);
      drag.box.style.width = String(drag.w) + 'px';
      drag.box.style.maxWidth = 'none';
      status('Lebar kotak: ' + Math.round(drag.w) + 'px');
    }
  }
  function finish(commit) {
    const d = drag;
    if (!d) return;
    drag = null;
    detach();
    d.box.classList.remove('is-moving');
    try { if (d.handle.hasPointerCapture(d.pointerId)) d.handle.releasePointerCapture(d.pointerId); } catch { /* ignore */ }
    if (!d.moved) { if (d.wasFlow) ctx.render(); return; }
    if (!commit) { ctx.render(); status('Perubahan kotak dibatalkan'); return; }
    if (d.mode === 'move') writeBoxGeometry(d.id, { positionX: round1(d.x), positionY: round1(d.y) });
    else if (d.mode === 'rotate') writeBoxGeometry(d.id, { rotation: d.rotation });
    else writeBoxGeometry(d.id, { boxWidth: Math.round(d.w) });
  }
  function onUp() { finish(true); }
  function onCancel() { finish(Boolean(drag && drag.moved)); }
  function onKey(e) { if (e.key === 'Escape') finish(false); }

  root.addEventListener('keydown', (event) => {
    if (ctx.getView() !== 'preview' || !selectedBox || selectionMode !== 'object') return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const active = document.activeElement;
    if (active?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName)) return;
    const doc = clone(ctx.getEditor().state.document);
    const section = doc.sections.find(item => item.kind === 'canvas' && (item.content || []).some(node => node.id === selectedBox));
    if (!section) return;
    const index = section.content.findIndex(node => node.id === selectedBox);
    if (event.ctrlKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const next = clamp(index + (event.key === 'ArrowUp' ? -1 : 1), 0, section.content.length - 1);
      if (next === index) return;
      const [node] = section.content.splice(index, 1);
      section.content.splice(next, 0, node);
      event.preventDefault();
      if (ctx.replaceModel(doc)) status(next < index ? 'Urutan objek dimajukan.' : 'Urutan objek dimundurkan.');
      return;
    }
    const node = section.content[index];
    const attrs = node.attrs || (node.attrs = {});
    const step = event.shiftKey ? 10 : 1;
    const dims = pageDims(section.page, ctx.PAGE_SIZES);
    const x = Number.isFinite(attrs.positionX) ? attrs.positionX : 0;
    const y = Number.isFinite(attrs.positionY) ? attrs.positionY : 0;
    if (!Number.isFinite(attrs.positionX) || !Number.isFinite(attrs.positionY)) {
      const el = root.querySelector('[data-box-id="' + cssId(selectedBox) + '"]');
      if (el) {
        const sheet = el.closest('.canvas-sheet');
        const rect = el.getBoundingClientRect();
        const sheetRect = sheet.getBoundingClientRect();
        const zoom = zoomOf();
        attrs.positionX = Math.max(0, (rect.left - sheetRect.left) / zoom);
        attrs.positionY = Math.max(0, (rect.top - sheetRect.top) / zoom);
      }
    }
    attrs.positionX = round1(clamp((Number(attrs.positionX) || x) + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), 0, dims.w - 24));
    attrs.positionY = round1(clamp((Number(attrs.positionY) || y) + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), 0, dims.h - 24));
    event.preventDefault();
    if (ctx.replaceModel(doc)) status('Posisi objek disesuaikan dengan tombol panah' + (event.shiftKey ? ' (10 px).' : ' (1 px).'));
  });
  root.addEventListener('pointerdown', (event) => {
    if (ctx.getView() !== 'preview' || event.button !== 0 || drag) return;
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    if (!target) return;
    const flowBlock = target.closest('.canvas-flow-block');
    const flowHandle = target.closest('.flow-box-handle, .flow-rotate-handle');
    const box = target.closest('.canvas-box') || (flowBlock && flowHandle ? flowBlock : null);
    if (!box) {
      if (selectedBox) { selectedBox = null; selectionMode = null; applyBoxSelection(); }
      return;
    }
    selectedBox = box.dataset.boxId;
    ctx.clearImageSelection();
    applyBoxSelection();
    const handle = target.closest('.box-handle, .box-resize, .box-rotate, .flow-box-handle, .flow-rotate-handle');
    if (!handle) { selectionMode = 'text'; return; } // plain click inside the text: let the browser place the caret
    selectionMode = 'object';
    // The box is selected as an object, not edited: drop the text caret so Delete/Backspace act on the object.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.getSelection()?.removeAllRanges();
    event.preventDefault();
    const sheet = box.closest('.canvas-sheet');
    const regionHost = box.closest('.canvas-header-layer, .canvas-footer-layer, .canvas-flow-layer') || sheet;
    const zoom = zoomOf();
    const boxRect = box.getBoundingClientRect();
    const wasFlow = box.classList.contains('canvas-flow-block');
    const hostRect = regionHost ? regionHost.getBoundingClientRect() : null;
    const flowX = wasFlow && hostRect ? (boxRect.left - hostRect.left) / zoom : 0;
    const flowY = wasFlow && hostRect ? (boxRect.top - hostRect.top) / zoom : 0;
    const mode = handle.classList.contains('box-rotate') || handle.classList.contains('flow-rotate-handle') ? 'rotate' : (handle.classList.contains('box-resize') ? 'resize' : 'move');
    const currentRotation = Number(box.dataset.rotation || 0) || 0;
    if (wasFlow) {
      box.style.position = 'absolute';
      box.style.left = String(flowX) + 'px';
      box.style.top = String(flowY) + 'px';
      box.style.width = String(boxRect.width / zoom) + 'px';
      box.style.maxWidth = 'none';
      box.style.zIndex = '6';
      regionHost.appendChild(box);
    }
    const centerX = boxRect.left + boxRect.width / 2;
    const centerY = boxRect.top + boxRect.height / 2;
    drag = {
      pointerId: event.pointerId, box, handle, id: box.dataset.boxId, wasFlow, mode,
      zoom, px: event.clientX, py: event.clientY, moved: false,
      x0: wasFlow ? flowX : (Number.parseFloat(box.style.left) || 0), y0: wasFlow ? flowY : (Number.parseFloat(box.style.top) || 0), w0: boxRect.width / zoom,
      sheetW: regionHost ? regionHost.clientWidth : (sheet ? sheet.offsetWidth : 600), sheetH: regionHost ? Math.max(regionHost.clientHeight, sheet ? sheet.offsetHeight : 0) : (sheet ? sheet.offsetHeight : 800),
      rotation0: currentRotation,
      pointerAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI,
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
    const actions = document.createElement('span');
    actions.className = 'page-card-actions';
    if (pg.kind === 'canvas') {
      const up = document.createElement('button');
      up.type = 'button'; up.className = 'page-card-move'; up.textContent = '\\u2191'; up.title = 'Pindahkan canvas ke urutan sebelumnya'; up.setAttribute('aria-label', 'Pindahkan canvas halaman ' + (i + 1) + ' ke atas'); up.disabled = pg.sectionIndex <= 0;
      up.addEventListener('click', (ev) => { ev.stopPropagation(); moveCanvasSection(pg.sectionId, -1); });
      const down = document.createElement('button');
      down.type = 'button'; down.className = 'page-card-move'; down.textContent = '\\u2193'; down.title = 'Pindahkan canvas ke urutan berikutnya'; down.setAttribute('aria-label', 'Pindahkan canvas halaman ' + (i + 1) + ' ke bawah'); down.disabled = pg.sectionIndex >= doc.sections.length - 1;
      down.addEventListener('click', (ev) => { ev.stopPropagation(); moveCanvasSection(pg.sectionId, 1); });
      actions.append(up, down);
      const copy = document.createElement('button');
      copy.type = 'button'; copy.className = 'page-card-move page-card-copy'; copy.textContent = 'Salin'; copy.title = 'Salin seluruh isi canvas ini'; copy.setAttribute('aria-label', 'Salin isi canvas halaman ' + (i + 1));
      copy.addEventListener('click', (ev) => { ev.stopPropagation(); copyCanvasContent(pg.sectionId); });
      actions.append(copy);
    }
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'page-card-del'; del.textContent = 'Hapus'; del.setAttribute('aria-label', 'Hapus halaman ' + (i + 1));
    del.addEventListener('click', (ev) => { ev.stopPropagation(); deleteCanvasSection(pg.sectionId); });
    actions.append(del);
    head.append(actions);
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

function splitOverflowingCanvas(doc, root) {
  for (let sectionIndex = 0; sectionIndex < doc.sections.length; sectionIndex++) {
    const section = doc.sections[sectionIndex];
    if (section.kind !== 'canvas') continue;
    const sheet = root.querySelector('.canvas-sheet[data-page-section="' + cssId(section.id) + '"]');
    const flow = sheet?.querySelector('.canvas-flow-layer');
    if (!sheet || !flow || flow.scrollHeight <= flow.clientHeight + 2) continue;

    const sheetRect = sheet.getBoundingClientRect();
    const bottomMargin = Number.parseFloat(getComputedStyle(sheet).getPropertyValue('--canvas-margin-bottom')) || 0;
    const contentBottom = sheetRect.bottom - bottomMargin;
    const flowBlocks = Array.from(flow.children).filter((el) => el.classList.contains('canvas-flow-block'));
    const firstOverflow = flowBlocks.findIndex((el) => el.getBoundingClientRect().bottom > contentBottom + 1);
    // A single block taller than the printable area cannot be split safely at the block boundary.
    // Surface the condition instead of silently clipping it.
    if (firstOverflow <= 0) {
      if (sheet.dataset.layoutWarning !== 'unsplittable-overflow') {
        sheet.dataset.layoutWarning = 'unsplittable-overflow';
        sheet.title = 'Konten pada halaman ini lebih tinggi dari area cetak dan tidak dapat dipisah otomatis dalam satu blok.';
        status('Peringatan tata letak: ada satu blok yang lebih tinggi dari area cetak. Pecah paragraf/tabel tersebut atau sesuaikan ukuran kontennya.');
      }
      continue;
    }
    delete sheet.dataset.layoutWarning;
    if (sheet.title === 'Konten pada halaman ini lebih tinggi dari area cetak dan tidak dapat dipisah otomatis dalam satu blok.') sheet.removeAttribute('title');

    const moved = new Set(flowBlocks.slice(firstOverflow).map((el) => section.content[Number(el.dataset.blockIndex)]).filter(Boolean));
    if (!moved.size || moved.size >= section.content.length) continue;

    const nextId = createIdAllocator(doc, ctx.ids);
    const nextSection = cloneSectionWithFreshIds(section, nextId);
    nextSection.kind = 'canvas';
    // First-page variants belong only to the original page; regular/even-page header/footer can repeat.
    delete nextSection.firstPageHeader;
    delete nextSection.firstPageFooter;
    // The overflowing flow nodes move, keeping their identities. Positioned objects stay on the page where
    // their saved coordinates refer to. Duplicated header/footer/variants receive new IDs.
    nextSection.content = section.content.filter((node) => moved.has(node));
    section.content = section.content.filter((node) => !moved.has(node));
    if (!section.content.length) section.content = [{ type: 'paragraph', id: nextId(), content: [] }];
    pendingScrollSectionId = section.id;
    doc.sections.splice(sectionIndex + 1, 0, nextSection);
    if (ctx.replaceModel(doc)) status('Canvas dipaginasi otomatis: konten yang melewati batas halaman dipindahkan ke Canvas berikutnya.');
    return true;
  }
  return false;
}

function refreshPages() {
  pagesTimer = 0;
  if (!ctx || ctx.getView() !== 'preview') return;
  const doc = clone(ctx.getEditor().state.document);
  const root = paper();
  root.querySelectorAll('.page-marker').forEach((el) => el.remove());
  if (splitOverflowingCanvas(doc, root)) return;
  pagesModel = computePages(ctx.getEditor().state.document);
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
  document.getElementById('pasteCanvasContent')?.addEventListener('click', pasteCopiedCanvasContent);
  document.getElementById('copyActiveCanvas')?.addEventListener('click', () => {
    const active = pagesModel[activePageIndex];
    if (!active || active.kind !== 'canvas') { status('Pilih halaman CANVAS terlebih dahulu untuk menyalin isinya.'); return; }
    copyCanvasContent(active.sectionId);
  });
  document.getElementById('pasteActiveCanvas')?.addEventListener('click', pasteCopiedCanvasContent);
  document.getElementById('addBox').addEventListener('click', addTextBox);
  document.getElementById('addCanvasImage').addEventListener('click', () => document.getElementById('canvasImageFile').click());
  document.getElementById('canvasImageFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    try { await addCanvasImage(file); } finally { e.target.value = ''; }
  });
  let scrollRaf = 0;
  scroller().addEventListener('scroll', () => { if (scrollRaf) return; scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; trackActivePage(); }); }, { passive: true });
  setupBoxInteraction();
  // Clicking unused canvas whitespace creates a normal-flow paragraph and places the caret there,
  // giving the page Word-like free typing while preserving explicitly positioned design objects.
  paper().addEventListener('click', (event) => {
    if (ctx.getView() !== 'preview') return;
    const target = elementOf(event.target);
    const sheet = target?.closest('.canvas-sheet');
    const regionHost = target?.closest('.canvas-header-layer, .canvas-footer-layer, .canvas-flow-layer');
    const region = regionHost?.classList.contains('canvas-header-layer') ? 'header' : regionHost?.classList.contains('canvas-footer-layer') ? 'footer' : 'content';
    if (!sheet) return;
    const sectionIndex = Number(sheet.dataset.sectionIndex);
    const doc = clone(ctx.getEditor().state.document);
    const section = doc.sections[sectionIndex];
    if (!section || section.kind !== 'canvas') return;
    const nextId = idFactory(doc);
    const node = { type: 'paragraph', id: nextId(), content: [] };
    section[region] = section[region] || [];
    section[region].push(node);
    if (!ctx.replaceModel(doc)) return;
    requestAnimationFrame(() => {
      const leaf = paper().querySelector('[data-block-id="' + cssId(node.id) + '"]');
      if (!leaf) return;
      leaf.focus();
      const range = document.createRange();
      range.selectNodeContents(leaf);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  });
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
