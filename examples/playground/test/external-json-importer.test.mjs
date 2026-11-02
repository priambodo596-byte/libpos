// Tests for the external block-JSON adapter. They assert on the document MODEL and validate the result with the real core schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNodeFactory, createSequentialIdGenerator, parseDocument } from '@convetlib/core';
import { detectJSONFormat, isNativeConvetlibJSON, isSupportedExternalJSON, convertExternalDocumentJSON, inlineFromText, countExternalMarkers } from '../src/external-json-importer.js';
import { planCanvasImport, collectUsedIds } from '../src/canvas-import.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const page = { size: { width: 11906, height: 16838 }, orientation: 'portrait', margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 } };

/** Mirrors the structure of the attached "Draf Kontrak Pengembangan Software" file (schemaVersion 1 header, but external blocks). */
function externalContract() {
  return {
    schemaVersion: 1, id: 'kontrak-pengembangan-software',
    meta: { title: 'Draf Kontrak Pengembangan Software', documentNumber: 'LGL-01/DRAF/KPS/2026', documentVersion: '1.0', status: 'DRAFT', language: 'id', createdAt: '2026-10-29T08:35:20.197Z', updatedAt: '2026-10-29T08:35:20.197Z', author: 'Legal AI Assistant', tags: ['contract', 'draft'] },
    placeholders: { client_only: ['{{client.company_name}}', '{{client.pic_name}}'], note: 'hanya data client' },
    sections: [
      { id: 'section-1', page: clone(page), content: [
        { type: 'callout', id: 'b-1-1', variant: 'draft', title: 'DRAF UNTUK REVIEW', text: 'Bukan nasihat hukum final.' },
        { type: 'heading', id: 'b-1-2', level: 1, text: 'DRAF KONTRAK PENGEMBANGAN SOFTWARE', align: 'center' },
        { type: 'metadataTable', id: 'b-1-3', rows: [{ label: 'Nomor Dokumen', value: '{{document.number}}' }, { label: 'Versi', value: '{{document.version}}' }] },
        { type: 'paragraph', id: 'b-1-4', text: 'Perjanjian ini dibuat pada tanggal ................ oleh dan antara:' },
        { type: 'table', id: 'b-1-5', columns: [{ key: 'party', label: 'Pihak', width: 22 }, { key: 'identity', label: 'Identitas', width: 78 }], rows: [
          { party: 'Pihak Pertama', identity: 'Penyedia jasa.' },
          { party: 'Pihak Kedua', identity: '{{client.company_name}}, diwakili {{client.pic_name}} selaku {{client.pic_title}}.' } ] },
      ] },
      { id: 'section-2', page: { ...clone(page), orientation: 'landscape' }, content: [
        { type: 'heading', id: 'b-2-1', level: 2, text: 'Pasal 1 — Definisi' },
        { type: 'list', id: 'b-2-2', ordered: true, items: ['Software berarti perangkat lunak.', 'Pekerjaan berarti seluruh aktivitas.'] },
        { type: 'list', id: 'b-2-3', ordered: false, items: ['Satu', { text: 'Dua', items: ['Dua-a'] }] },
        { type: 'paragraph', id: 'b-2-4', variant: 'note', text: 'Catatan\nbaris kedua' },
        { type: 'signatureBlock', id: 'b-2-9', columns: [{ role: 'Pihak Pertama', name: '....', title: '....', company: '....' }, { role: 'Pihak Kedua', name: '{{client.pic_name}}', title: '{{client.pic_title}}', company: '{{client.company_name}}' }] },
        { type: 'mysteryWidget', id: 'b-2-10', text: 'jangan hilang' },
      ] },
    ],
    comments: {
      'comment-1': { id: 'comment-1', anchor: 'b-1-5', author: 'Legal AI Assistant', role: 'drafting-assistant', message: 'Verifikasi kewenangan penandatangan.', status: 'open', createdAt: '2026-10-29T08:35:20.197Z' },
      'comment-2': { id: 'comment-2', anchor: 'b-2-1', author: 'Reviewer', message: 'Sudah dicek.', status: 'resolved', createdAt: '2026-10-29T08:35:20.197Z' },
    },
    revisions: { 'rev-1': { id: 'rev-1', version: '1.0', date: '2026-10-29', change: 'Draf awal', author: 'Legal AI Assistant', approver: null, status: 'draft' } },
  };
}

/** Native Convetlib JSON like the attached spj-document.json: placeholders split over several text runs, image in header. */
function nativeSpj() {
  const ids = createSequentialIdGenerator('n-');
  const n = createNodeFactory(ids);
  const doc = createDocument({ ids, id: 'docx-72', title: 'Template Surat Undangan', now: '2026-10-26T09:20:45.510Z', content: [n.paragraph('')] });
  const run = (text) => ({ type: 'text', text, marks: [{ type: 'textStyle', attrs: { fontSize: 9.5, color: '#000000' } }] });
  doc.sections[0].content = [
    { type: 'paragraph', id: 'p-1', attrs: { indentLeft: 1418 }, content: [run('{{'), run('Jenis'), run('_'), run('Pekerjaan'), run('}}')] },
    { type: 'paragraph', id: 'p-2', content: [run('{'), run('{'), run('No'), run('}'), run('}.')] },
  ];
  doc.sections[0].header = [{ type: 'image', id: 'img-1', attrs: { src: 'data:image/png;base64,AAAA', alt: 'Imported image', width: 68, height: 69 } }];
  return doc;
}

const convert = (raw, extra = {}) => convertExternalDocumentJSON(raw, { generateId: createSequentialIdGenerator('x-'), now: '2026-10-30T00:00:00.000Z', ...extra });
const textOf = (nodes) => (nodes || []).map((n) => (n.type === 'text' ? n.text : n.type === 'placeholder' ? `{{${n.attrs.key}}}` : n.type === 'hardBreak' ? '\n' : textOf(n.content))).join(' ');
const find = (nodes, type, out = []) => { for (const n of nodes || []) { if (n.type === type) out.push(n); find(n.content, type, out); } return out; };
const allIds = (doc) => [...collectUsedIds(doc)];

test('1. native JSON is detected as native (also the spj-style file with split placeholders)', () => {
  assert.equal(detectJSONFormat(nativeSpj()), 'native');
  assert.equal(isNativeConvetlibJSON(nativeSpj()), true);
  assert.equal(countExternalMarkers(nativeSpj()), 0);
});

test('2. external JSON with a native-looking header (schemaVersion 1) is detected as external, not native', () => {
  const raw = externalContract();
  assert.equal(isNativeConvetlibJSON(raw), false, 'header looks native but blocks are external');
  assert.equal(detectJSONFormat(raw), 'external');
  assert.ok(countExternalMarkers(raw) >= 8);
  assert.equal(isSupportedExternalJSON(raw), true);
});

test('3. metadata: title/language kept, everything else preserved in meta.custom', () => {
  const { document } = convert(externalContract());
  assert.equal(document.meta.title, 'Draf Kontrak Pengembangan Software');
  assert.equal(document.meta.language, 'id');
  const c = document.meta.custom.externalImport;
  assert.equal(c.sourceMeta.documentNumber, 'LGL-01/DRAF/KPS/2026');
  assert.equal(c.sourceMeta.status, 'DRAFT');
  assert.deepEqual(c.sourceMeta.tags, ['contract', 'draft']);
  assert.deepEqual(c.placeholders.client_only, ['{{client.company_name}}', '{{client.pic_name}}']);
});

test('4. headings keep their level (top-level `level`) and alignment', () => {
  const { document } = convert(externalContract());
  const h1 = document.sections[0].content.find((n) => n.type === 'heading');
  const h2 = document.sections[1].content.find((n) => n.type === 'heading');
  assert.equal(h1.attrs.level, 1); assert.equal(h1.attrs.align, 'center');
  assert.equal(h2.attrs.level, 2);
  assert.match(textOf(h2.content), /Pasal 1 — Definisi/);
});

test('5. paragraphs keep text, line breaks and variant styling', () => {
  const { document } = convert(externalContract());
  const intro = document.sections[0].content.find((n) => n.id === 'b-1-4');
  assert.match(textOf(intro.content), /\.{16}/);
  const note = document.sections[1].content.find((n) => n.id === 'b-2-4');
  assert.ok(note.content.some((c) => c.type === 'hardBreak'));
  assert.ok(note.content.filter((c) => c.type === 'text').every((c) => c.marks.some((m) => m.type === 'italic')));
});

test('6. tables: header row from columns, all rows/cells kept, widths in twips', () => {
  const { document } = convert(externalContract());
  const t = document.sections[0].content.find((n) => n.id === 'b-1-5');
  assert.equal(t.type, 'table');
  assert.equal(t.content.length, 3, 'header + 2 rows');
  assert.equal(textOf(t.content[0].content[0].content), 'Pihak');
  assert.equal(textOf(t.content[0].content[1].content), 'Identitas');
  assert.ok(t.content[0].content[0].content[0].content[0].marks.some((m) => m.type === 'bold'));
  assert.equal(t.content[1].content.length, 2);
  const w = t.content[1].content.map((c) => c.attrs.width);
  assert.ok(Math.abs(w[0] / (w[0] + w[1]) - 0.22) < 0.01);
  const meta = document.sections[0].content.find((n) => n.id === 'b-1-3');
  assert.equal(meta.content.length, 2);
  assert.equal(textOf(meta.content[0].content[0].content), 'Nomor Dokumen');
});

test('7. ordered / unordered / nested lists', () => {
  const { document } = convert(externalContract());
  const ol = document.sections[1].content.find((n) => n.id === 'b-2-2');
  const ul = document.sections[1].content.find((n) => n.id === 'b-2-3');
  assert.equal(ol.type, 'orderedList'); assert.equal(ol.content.length, 2);
  assert.equal(ul.type, 'bulletList'); assert.equal(ul.content.length, 2);
  assert.equal(find(ul.content[1].content, 'bulletList').length, 1, 'nested list kept');
});

test('8. callout becomes a blockquote with bold title; variant kept in meta.custom', () => {
  const { document } = convert(externalContract());
  const q = document.sections[0].content.find((n) => n.id === 'b-1-1');
  assert.equal(q.type, 'blockquote');
  assert.equal(textOf(q.content[0].content), 'DRAF UNTUK REVIEW');
  assert.ok(q.content[0].content[0].marks.some((m) => m.type === 'bold'));
  assert.equal(textOf(q.content[1].content), 'Bukan nasihat hukum final.');
  assert.equal(document.meta.custom.externalImport.callouts[0].variant, 'draft');
});

test('9. signature block keeps every party and field', () => {
  const { document } = convert(externalContract());
  const t = document.sections[1].content.find((n) => n.id === 'b-2-9');
  assert.equal(t.content.length, 1);
  assert.equal(t.content[0].content.length, 2);
  const second = textOf(t.content[0].content[1].content);
  assert.match(second, /Pihak Kedua/); assert.match(second, /\{\{client\.pic_name\}\}/); assert.match(second, /\{\{client\.company_name\}\}/);
});

test('10. {{placeholders}} become real placeholder nodes (also inside tables), never plain text', () => {
  const { document } = convert(externalContract());
  const keys = new Set(find(document.sections.flatMap((s) => s.content), 'placeholder').map((p) => p.attrs.key));
  for (const k of ['document.number', 'document.version', 'client.company_name', 'client.pic_name', 'client.pic_title']) assert.ok(keys.has(k), k);
  const leftovers = JSON.stringify(document.sections).match(/"text":"[^"]*\{\{/g);
  assert.equal(leftovers, null, 'no "{{" left in text nodes');
  assert.deepEqual(inlineFromText('a {{x.y}} b'), [{ type: 'text', text: 'a ' }, { type: 'placeholder', attrs: { key: 'x.y' } }, { type: 'text', text: ' b' }]);
});

test('11. multi-section: order and count preserved', () => {
  const { document, report } = convert(externalContract());
  assert.equal(document.sections.length, 2);
  assert.equal(report.sections, 2);
  assert.equal(document.sections[0].id, 'section-1');
  assert.match(textOf(document.sections[0].content), /DRAF KONTRAK/);
  assert.match(textOf(document.sections[1].content), /Pasal 1/);
});

test('12. page settings (size, orientation, margins) preserved; missing page falls back to the default page', () => {
  const { document } = convert(externalContract());
  assert.deepEqual(document.sections[0].page, page);
  assert.equal(document.sections[1].page.orientation, 'landscape');
  const raw = externalContract(); delete raw.sections[0].page;
  const fb = { size: { width: 12240, height: 15840 }, orientation: 'portrait', margins: { ...page.margins, top: 720 } };
  assert.deepEqual(convert(raw, { defaultPage: fb }).document.sections[0].page, fb);
});

test('13. comments keep text/author/status and are anchored; revisions are preserved', () => {
  const { document, report } = convert(externalContract());
  const c1 = document.comments['comment-1'];
  assert.equal(c1.body, 'Verifikasi kewenangan penandatangan.');
  assert.equal(c1.authorId, 'Legal AI Assistant');
  assert.equal(c1.resolved, false);
  assert.equal(document.comments['comment-2'].resolved, true);
  const marked = JSON.stringify(document.sections).includes('"commentId":"comment-1"');
  assert.ok(marked, 'comment-1 anchored on block b-1-5');
  assert.equal(report.anchoredComments, 2);
  assert.equal(document.meta.custom.externalImport.comments['comment-1'].role, 'drafting-assistant');
  assert.equal(report.revisionsPreserved, 1);
  assert.equal(document.meta.custom.externalImport.revisionHistory[0].change, 'Draf awal');
});

test('14. unknown node: text kept as paragraph, raw JSON kept in meta.custom, reported', () => {
  const { document, report } = convert(externalContract());
  const p = document.sections[1].content.find((n) => n.type === 'paragraph' && textOf(n.content) === 'jangan hilang');
  assert.ok(p);
  assert.equal(report.unknownNodes, 1);
  assert.equal(document.meta.custom.externalImport.unknownNodes[0].type, 'mysteryWidget');
});

test('15. invalid input: not-an-object / no sections is rejected or reported unknown', () => {
  assert.equal(detectJSONFormat(null), 'unknown');
  assert.equal(detectJSONFormat([1, 2]), 'unknown');
  assert.equal(detectJSONFormat({ sections: [] }), 'unknown');
  assert.equal(detectJSONFormat({ sections: [{ id: 's' }] }), 'unknown');
  assert.equal(detectJSONFormat({ hello: 'world' }), 'unknown');
  assert.throws(() => convert({ hello: 'world' }), /sections/);
  assert.throws(() => JSON.parse('{ not json'));
});

test('16. the converted document passes the real core schema validation', () => {
  const { document } = convert(externalContract());
  const parsed = parseDocument(document);
  assert.equal(parsed.ok, true, parsed.ok ? '' : JSON.stringify(parsed.issues.slice(0, 5)));
  assert.deepEqual(allIds(document).length, new Set(allIds(document)).size);
});

test('17. re-import does not duplicate: same ids never repeat, repeated canvas import keeps one copy of the text', () => {
  const ids = createSequentialIdGenerator('x-');
  const first = convertExternalDocumentJSON(externalContract(), { generateId: ids }).document;
  const second = convertExternalDocumentJSON(externalContract(), { generateId: ids }).document;
  assert.equal(parseDocument(second).ok, true);
  // each conversion yields unique ids inside itself
  for (const d of [first, second]) assert.equal(allIds(d).length, new Set(allIds(d)).size);

  const gen = createSequentialIdGenerator('spj-');
  const n = createNodeFactory(gen);
  const base = createDocument({ ids: gen, id: 'cur', title: 'cur', now: '2026-10-30T00:00:00.000Z', content: [n.paragraph('')] });
  base.sections[0].kind = 'canvas';
  const target = base.sections[0].id;
  const once = planCanvasImport(base, convert(externalContract(), { generateId: gen }).document, target, gen);
  const twice = planCanvasImport(once.doc, convert(externalContract(), { generateId: gen }).document, target, gen);
  const count = (d) => JSON.stringify(d.sections).split('DRAF KONTRAK PENGEMBANGAN SOFTWARE').length - 1;
  assert.equal(count(once.doc), 1);
  assert.equal(count(twice.doc), 1, 'second import replaces the active canvas instead of appending');
  assert.equal(allIds(twice.doc).length, new Set(allIds(twice.doc)).size);
  assert.equal(parseDocument(twice.doc).ok, true);
});

test('18. native path is untouched: native docs are never converted and keep a stricter detection', () => {
  const native = nativeSpj();
  assert.equal(detectJSONFormat(native), 'native');
  const lookalike = clone(native); lookalike.sections[0].content.push({ type: 'callout', id: 'c-1', title: 'x', text: 'y' });
  assert.equal(detectJSONFormat(lookalike), 'external', 'external-only block inside an otherwise native doc is routed to the adapter');
  const { document } = convert(lookalike);
  assert.equal(document.sections[0].content[0].attrs.indentLeft, 1418, 'native paragraph attrs survive the adapter');
  assert.equal(document.sections[0].content[0].content.map((c) => c.text).join(''), '{{Jenis_Pekerjaan}}', 'split runs are kept; the playground merges them into a placeholder afterwards');
  assert.equal(document.sections[0].header[0].type, 'image');
  assert.equal(parseDocument(document).ok, true);
});
