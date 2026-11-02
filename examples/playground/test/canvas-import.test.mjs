// Regression tests for importing JSON / DOCX / DOTX into the ACTIVE canvas. They assert on the document MODEL, not on DOM nodes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNodeFactory, createSection, createSequentialIdGenerator, defaultPageSetup, parseDocument } from '@convetlib/core';
import { importDocx } from '@convetlib/docx';
import { planCanvasImport, preserveBlankCanvases, createIdAllocator, collectUsedIds, isBlankCanvas, REGIONS } from '../src/canvas-import.js';
import { buildFixtureDocument, buildSingleSectionDocument, buildDocxBytes, toDotxBytes, duplicateIds, regionSummary, textOf, countType } from './fixtures.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Same shape the playground produces: [flow page, Canvas 1, Canvas 2, Canvas 3], ids from one `spj-N` counter. */
function buildCurrent({ canvas1Text = 'ISI-CANVAS-1', canvas3Text = 'ISI-CANVAS-3' } = {}) {
  const ids = createSequentialIdGenerator('spj-');
  const n = createNodeFactory(ids);
  const doc = createDocument({ ids, id: 'document-playground', title: 'Dokumen Baru', now: '2026-10-29T00:00:00.000Z', content: [n.paragraph('')] });
  const canvas = (text) => { const s = createSection([n.paragraph(text)], { ids, page: defaultPageSetup() }); s.kind = 'canvas'; return s; };
  doc.sections.push(canvas(canvas1Text), canvas(''), canvas(canvas3Text));
  return { doc, ids, canvasIds: doc.sections.slice(1).map((s) => s.id) };
}
const gen = (ids) => ids; // the playground passes its own generator; tests share the document's counter on purpose

async function importedFrom(kind) {
  if (kind === 'json') return clone(buildSingleSectionDocument());
  const docx = await buildDocxBytes(buildSingleSectionDocument());
  const bytes = kind === 'dotx' ? await toDotxBytes(docx) : docx;
  return importDocx(new Uint8Array(bytes), { title: 'fixture' });
}

for (const kind of ['json', 'docx', 'dotx']) {
  test(`${kind.toUpperCase()}: import lands in the ACTIVE canvas (Canvas 2) and nothing else changes`, async () => {
    const { doc, ids, canvasIds } = buildCurrent();
    const before = clone(doc);
    const imported = await importedFrom(kind);
    const plan = planCanvasImport(doc, imported, canvasIds[1], gen(ids));
    assert.ok(plan, 'a plan must exist for an existing canvas');

    const out = plan.doc;
    assert.equal(out.sections.length, before.sections.length, 'single-section source adds no sections');
    assert.equal(out.sections[2].id, canvasIds[1], 'Canvas 2 keeps its identity');
    assert.equal(plan.targetSectionId, canvasIds[1], 'the active canvas does not move');
    assert.equal(plan.targetIndex, 2);
    assert.equal(out.sections[2].kind, 'canvas');

    const s = regionSummary(out.sections[2]);
    assert.match(s.content.text, /SURAT DINAS/);
    assert.match(s.content.text, /Isi paragraf pertama section satu\./);
    assert.match(s.content.text, /Penutup section satu\./);
    assert.equal(s.content.tables, 1, 'body table kept');
    assert.equal(s.content.images, 1, 'body image kept');
    assert.match(s.header.text, /KOP INSTANSI SATU/);
    assert.equal(s.header.images, 1, 'header logo kept');
    assert.match(s.footer.text, /Alamat:/);
    // placeholders: a real node in JSON, `{{ key }}` text in DOCX (the playground converts it to a node afterwards)
    if (kind === 'json') { assert.equal(s.content.placeholders, 1); assert.equal(s.footer.placeholders, 1); }
    else { assert.match(s.content.text, /\{\{\s*surat\.nomor\s*\}\}/); assert.match(s.footer.text, /\{\{\s*instansi\.alamat\s*\}\}/); }

    // every other section is byte-for-byte untouched
    for (const i of [0, 1, 3]) assert.deepEqual(out.sections[i], before.sections[i], `section ${i} must be unchanged`);
    assert.deepEqual(duplicateIds(out), []);
    assert.deepEqual(before, doc, 'input document must not be mutated');
    assert.equal(parseDocument(out).ok, true, 'result must pass core validation');
  });
}

test('import into Canvas 1 does not touch Canvas 2 / 3 (target follows the active canvas, not index 0)', async () => {
  const { doc, ids, canvasIds } = buildCurrent();
  const before = clone(doc);
  const plan = planCanvasImport(doc, await importedFrom('json'), canvasIds[0], gen(ids));
  assert.match(textOf(plan.doc.sections[1].content), /SURAT DINAS/);
  for (const i of [0, 2, 3]) assert.deepEqual(plan.doc.sections[i], before.sections[i]);
});

test('multi-section source: sections are NOT blended; extra sections follow the target as their own sections', () => {
  const { doc, ids, canvasIds } = buildCurrent();
  const plan = planCanvasImport(doc, buildFixtureDocument(), canvasIds[1], gen(ids));
  const out = plan.doc;
  assert.equal(out.sections.length, doc.sections.length + 1);
  const target = regionSummary(out.sections[2]);
  assert.match(target.header.text, /KOP INSTANSI SATU/);
  assert.doesNotMatch(target.header.text, /SECTION DUA/, 'second section header must not leak into the target header');
  assert.doesNotMatch(target.footer.text, /SECTION DUA/, 'second section footer must not leak into the target footer');
  assert.doesNotMatch(target.content.text, /SECTION DUA/, 'second section body must not leak into the target body');
  const extra = regionSummary(out.sections[3]);
  assert.equal(plan.addedSectionIds[0], out.sections[3].id);
  assert.match(extra.content.text, /SECTION DUA/);
  assert.match(extra.header.text, /HEADER SECTION DUA/);
  assert.match(extra.footer.text, /FOOTER SECTION DUA/);
  assert.equal(out.sections[4].id, canvasIds[2], 'Canvas 3 still follows, unchanged');
  assert.deepEqual(out.sections[4], doc.sections[3]);
  assert.deepEqual(duplicateIds(out), []);
  assert.equal(parseDocument(out).ok, true);
});

test('a deliberately blank first-page header/footer ([]) survives; stale variants of the old content are cleared', () => {
  const { doc, ids, canvasIds } = buildCurrent();
  doc.sections[2].evenPageHeader = [createNodeFactory(createSequentialIdGenerator('stale-')).paragraph('STALE EVEN HEADER')];
  const plan = planCanvasImport(doc, buildFixtureDocument(), canvasIds[1], gen(ids));
  const target = plan.doc.sections[2];
  assert.ok(Array.isArray(target.firstPageHeader) && target.firstPageHeader.length === 0, 'firstPageHeader [] must stay [] (blank), not become "unset"');
  assert.ok(Array.isArray(target.firstPageFooter) && target.firstPageFooter.length === 0);
  assert.equal(target.evenPageHeader, undefined, 'variants of the replaced content must not linger');
});

test('ids stay unique even when the source reuses ids of the current document and the generator is hostile', () => {
  const { doc, canvasIds } = buildCurrent();
  const colliding = buildFixtureDocument({ prefix: 'spj-' }); // source ids spj-1.. collide with the current document
  const freshEachTime = () => createSequentialIdGenerator('spj-')(); // always "spj-1": a worst-case generator
  assert.throws(() => planCanvasImport(doc, colliding, canvasIds[1], freshEachTime), /unique id/, 'a constant generator must fail loudly, not hang');
  const ok = planCanvasImport(doc, colliding, canvasIds[1], createSequentialIdGenerator('spj-'));
  assert.deepEqual(duplicateIds(ok.doc), []);
});

test('ids in first/even-page variants and nested table nodes count as used', () => {
  const { doc } = buildCurrent();
  const n = createNodeFactory(createSequentialIdGenerator('v-'));
  doc.sections[1].evenPageFooter = [n.table([['a', 'b']])];
  const used = collectUsedIds(doc);
  for (const region of REGIONS) assert.ok(region);
  assert.ok(used.has('v-1') && used.has('v-2') && used.has('v-3') && used.has('v-4'), 'table, rows, cells and paragraphs of a variant are all registered');
  const next = createIdAllocator(doc, createSequentialIdGenerator('v-'));
  assert.ok(!used.has(next()), 'allocator skips ids that only exist inside a variant');
});

test('repeated imports do not duplicate content or ids and never move the active canvas', async () => {
  const { doc, ids, canvasIds } = buildCurrent();
  let current = doc;
  const imported = await importedFrom('docx');
  for (let i = 0; i < 4; i++) {
    const plan = planCanvasImport(current, imported, canvasIds[1], gen(ids));
    current = plan.doc;
    assert.equal(plan.targetSectionId, canvasIds[1]);
  }
  assert.equal(current.sections.length, doc.sections.length);
  assert.equal(textOf(current.sections[2].content).split('SURAT DINAS').length - 1, 1, 'body text exists exactly once');
  assert.equal(countType(current.sections[2].header, 'image'), 1, 'header logo exists exactly once');
  assert.deepEqual(duplicateIds(current), []);
  assert.deepEqual(current.sections[1], doc.sections[1]);
  assert.deepEqual(current.sections[3], doc.sections[3]);
});

test('importing into two different canvases keeps each import in its own canvas', async () => {
  const { doc, ids, canvasIds } = buildCurrent();
  const a = planCanvasImport(doc, buildSingleSectionDocument({ title: 'A' }), canvasIds[0], gen(ids)).doc;
  const second = buildSingleSectionDocument();
  second.sections[0].content = [createNodeFactory(createSequentialIdGenerator('b-')).paragraph('ISI-KEDUA')];
  const b = planCanvasImport(a, second, canvasIds[1], gen(ids)).doc;
  assert.match(textOf(b.sections[1].content), /SURAT DINAS/);
  assert.match(textOf(b.sections[2].content), /ISI-KEDUA/);
  assert.doesNotMatch(textOf(b.sections[2].content), /SURAT DINAS/);
  assert.deepEqual(duplicateIds(b), []);
});

test('no plan when there is no usable target: unknown id, flow section, or empty source', () => {
  const { doc, ids } = buildCurrent();
  const src = buildSingleSectionDocument();
  assert.equal(planCanvasImport(doc, src, 'does-not-exist', gen(ids)), null);
  assert.equal(planCanvasImport(doc, src, doc.sections[0].id, gen(ids)), null, 'a flow page is not a canvas target');
  assert.equal(planCanvasImport(doc, { ...src, sections: [] }, doc.sections[1].id, gen(ids)), null);
  assert.equal(planCanvasImport(doc, null, doc.sections[1].id, gen(ids)), null);
});

test('imported page setup is kept on the canvas (size/orientation come from the document)', () => {
  const { doc, ids, canvasIds } = buildCurrent();
  const src = buildSingleSectionDocument();
  src.sections[0].page = { size: { width: 12240, height: 15840 }, orientation: 'landscape', margins: { top: 720, right: 720, bottom: 720, left: 720, header: 360, footer: 360 } };
  const out = planCanvasImport(doc, src, canvasIds[1], gen(ids)).doc;
  assert.deepEqual(out.sections[2].page, src.sections[0].page);
  assert.deepEqual(out.sections[1].page, doc.sections[1].page, 'other canvases keep their own page setup');
});

test('preserveBlankCanvases keeps freshly created blank canvases when the import replaces the document', () => {
  const { doc, ids } = buildCurrent({ canvas1Text: '', canvas3Text: 'HAS-CONTENT' });
  const imported = clone(buildSingleSectionDocument({ prefix: 'spj-' })); // ids collide with the current doc on purpose
  const out = preserveBlankCanvases(doc, imported, gen(ids));
  assert.equal(out.sections.length, 1 + 2, 'imported section + two blank canvases (Canvas 1 and Canvas 2); the content canvas is not carried over');
  assert.ok(out.sections.slice(1).every(isBlankCanvas));
  assert.deepEqual(duplicateIds(out), []);
  assert.equal(parseDocument(out).ok, true);
});

test('isBlankCanvas rejects canvases that carry header, variants or text', () => {
  const { doc } = buildCurrent({ canvas1Text: '' });
  assert.equal(isBlankCanvas(doc.sections[1]), true);
  const withHeader = clone(doc.sections[1]); withHeader.header = [createNodeFactory(createSequentialIdGenerator('h-')).paragraph('x')];
  assert.equal(isBlankCanvas(withHeader), false);
  const withVariant = clone(doc.sections[1]); withVariant.firstPageHeader = [];
  assert.equal(isBlankCanvas(withVariant), false);
  assert.equal(isBlankCanvas(doc.sections[0]), false, 'flow sections are never blank canvases');
});

// ---- negative control: the legacy "flatten every source section into the target" algorithm -------------------------------
// This documents the defect the audit found and proves the assertions above would have caught it.
function legacyBlindMerge(current, imported, targetId) {
  const doc = clone(current);
  const target = doc.sections.find((s) => s.id === targetId);
  const flatten = (region) => imported.sections.flatMap((s) => clone(s[region] || []));
  target.content = flatten('content'); target.header = flatten('header'); target.footer = flatten('footer');
  for (const v of ['firstPageHeader', 'firstPageFooter', 'evenPageHeader', 'evenPageFooter']) { const items = flatten(v); if (items.length) target[v] = items; else delete target[v]; }
  return doc;
}
test('control: the legacy blind merge blends sections and drops blank variants (this is what the audit fixed)', () => {
  const { doc, canvasIds } = buildCurrent();
  const legacy = legacyBlindMerge(doc, buildFixtureDocument(), canvasIds[1]).sections[2];
  assert.match(textOf(legacy.header), /SECTION DUA/, 'legacy leaked the second section header into the first');
  assert.match(textOf(legacy.content), /SECTION DUA/, 'legacy mixed section bodies together');
  assert.equal(legacy.firstPageHeader, undefined, 'legacy silently turned a blank first-page header into "unset"');
});
