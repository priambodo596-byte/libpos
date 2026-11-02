// Shared fixtures for the Canvas import regression tests and the browser audit.
// Everything is built with the library's own factories/exporters so the files are representative, not hand-crafted JSON.
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { createDocument, createNodeFactory, createSequentialIdGenerator, createSection, defaultPageSetup } from '@convetlib/core';
import { exportDocx } from '@convetlib/docx';

const require = createRequire(new URL('../../../packages/docx/package.json', import.meta.url));
const JSZip = require('jszip');

// ---- tiny deterministic PNG (solid colour) --------------------------------------------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function solidPng(width, height, [r, g, b]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) { raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const LOGO_PNG = solidPng(120, 60, [20, 90, 200]);
export const LOGO_DATA_URI = 'data:image/png;base64,' + LOGO_PNG.toString('base64');
export const resolveImage = async (source) => {
  const match = /^data:image\/png;base64,(.*)$/.exec(source);
  if (!match) throw new Error('fixture images must be PNG data URIs');
  return { data: new Uint8Array(Buffer.from(match[1], 'base64')), type: 'png' };
};

// ---- fixture document -----------------------------------------------------------------------------------------------
/**
 * Two-section "kop surat" document. Section 1 carries every region the importer/merger must not lose:
 * default header (text + logo image), footer (text + placeholder), a deliberately BLANK first-page header/footer
 * (`[]`, which means "blank" in the model - not "unset"), a table, a placeholder and an unpositioned image.
 * Section 2 has its own header/footer so mixing of sections is detectable.
 */
export function buildFixtureDocument({ prefix = 'fx-', title = 'Fixture kop surat' } = {}) {
  const ids = createSequentialIdGenerator(prefix);
  const n = createNodeFactory(ids);
  const a4 = defaultPageSetup();
  const doc = createDocument({
    ids, title, now: '2026-10-29T00:00:00.000Z', id: prefix + 'doc',
    content: [
      n.heading(1, 'SURAT DINAS'),
      n.paragraph([n.text('Nomor: '), n.placeholder('surat.nomor')]),
      n.paragraph('Isi paragraf pertama section satu.'),
      n.table([['Kolom A', 'Kolom B'], ['Nilai 1', 'Nilai 2']]),
      n.image(LOGO_DATA_URI, { alt: 'logo isi', width: 120, height: 60 }),
      n.paragraph('Penutup section satu.'),
    ],
    page: a4,
  });
  const s1 = doc.sections[0];
  s1.header = [n.paragraph('KOP INSTANSI SATU', { align: 'center' }), n.image(LOGO_DATA_URI, { alt: 'logo kop', width: 120, height: 60, align: 'left' })];
  s1.footer = [n.paragraph([n.text('Alamat: '), n.placeholder('instansi.alamat')], { align: 'center' })];
  s1.firstPageHeader = [];
  s1.firstPageFooter = [];
  const s2 = createSection([n.heading(2, 'SECTION DUA'), n.paragraph('Isi section kedua.')], { ids, page: a4 });
  s2.header = [n.paragraph('HEADER SECTION DUA')];
  s2.footer = [n.paragraph('FOOTER SECTION DUA')];
  doc.sections.push(s2);
  return doc;
}

/** A single-section variant (what DOCX import produces) for tests that need exactly one source section. */
export function buildSingleSectionDocument(opts = {}) {
  const doc = buildFixtureDocument(opts);
  doc.sections = [doc.sections[0]];
  return doc;
}

export async function buildDocxBytes(doc = buildSingleSectionDocument()) {
  return exportDocx(doc, { resolveImage });
}

/** DOTX = the same package with the main part's content type switched to the template type. */
export async function toDotxBytes(docxBytes) {
  const zip = await JSZip.loadAsync(docxBytes);
  const path = '[Content_Types].xml';
  const xml = await zip.file(path).async('string');
  const next = xml.replace('wordprocessingml.document.main+xml', 'wordprocessingml.template.main+xml');
  if (next === xml) throw new Error('could not switch content type to template');
  zip.file(path, next);
  return zip.generateAsync({ type: 'uint8array' });
}

// ---- model inspection helpers (verify model content, never just DOM) -------------------------------------------------
export const REGIONS = ['header', 'content', 'footer', 'firstPageHeader', 'firstPageFooter', 'evenPageHeader', 'evenPageFooter'];

export function collectAllIds(doc) {
  const out = [];
  const walk = (nodes) => { for (const node of nodes || []) { if (node && typeof node === 'object') { if (node.id) out.push(node.id); if (Array.isArray(node.content)) walk(node.content); } } };
  for (const section of doc.sections || []) { out.push(section.id); for (const r of REGIONS) walk(section[r]); }
  return out;
}
export function duplicateIds(doc) {
  const seen = new Set(), dup = new Set();
  for (const id of collectAllIds(doc)) { if (seen.has(id)) dup.add(id); seen.add(id); }
  return [...dup];
}
export function textOf(nodes) {
  let out = '';
  const walk = (list) => { for (const node of list || []) { if (!node) continue; if (node.type === 'text') out += node.text; else if (node.type === 'placeholder') out += '{{' + (node.attrs?.key ?? '') + '}}'; if (Array.isArray(node.content)) { walk(node.content); out += '\n'; } } };
  walk(nodes);
  return out;
}
export function countType(nodes, type) {
  let count = 0;
  const walk = (list) => { for (const node of list || []) { if (!node) continue; if (node.type === type) count++; if (Array.isArray(node.content)) walk(node.content); } };
  walk(nodes);
  return count;
}
export function regionSummary(section) {
  const summary = { id: section.id, kind: section.kind ?? 'flow' };
  for (const r of REGIONS) summary[r] = section[r] === undefined ? undefined : { text: textOf(section[r]).replace(/\n+/g, ' | ').trim(), images: countType(section[r], 'image'), tables: countType(section[r], 'table'), placeholders: countType(section[r], 'placeholder'), blocks: section[r].length };
  return summary;
}

/** One section whose body is clearly taller than an A4 page (used to detect clipping). */
export function buildLongDocument({ prefix = 'lg-', paragraphs = 70 } = {}) {
  const ids = createSequentialIdGenerator(prefix);
  const n = createNodeFactory(ids);
  const content = [n.heading(1, 'DOKUMEN PANJANG')];
  for (let i = 1; i <= paragraphs; i++) content.push(n.paragraph(`Paragraf ke-${i}. Teks ini cukup panjang supaya membungkus ke beberapa baris pada lebar halaman A4 dan memenuhi tinggi halaman dengan cepat.`));
  content.push(n.paragraph('PARAGRAF-TERAKHIR'));
  return createDocument({ ids, title: 'Dokumen panjang', now: '2026-10-29T00:00:00.000Z', id: prefix + 'doc', content, page: defaultPageSetup() });
}