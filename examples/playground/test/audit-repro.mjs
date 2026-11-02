// Exploratory reproduction: create canvases, select Canvas 2, import each fixture, print model + geometry evidence.
// Usage: node test/audit-repro.mjs <prefix>   (prefix = before | after; used for screenshot names)
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { startPlayground, launchBrowser, openPlayground, readDoc, readStatus, addCanvas, selectPage, importFile, measureLayout, artifactDir, fixtureDir } from './browser-helpers.mjs';
import { REGIONS, regionSummary, duplicateIds } from './fixtures.mjs';

const prefix = process.argv[2] || 'before';
const { server, url } = await startPlayground();
const browser = await launchBrowser();

const summarize = (doc) => doc.sections.map((s, i) => ({ i, ...regionSummary(s) }));

async function scenario(label, fixtureFile) {
  const { page, context, errors } = await openPlayground(browser, url);
  console.log(`\n===== ${label} (${fixtureFile}) =====`);
  await addCanvas(page); // section 1 = "Canvas 1"
  await addCanvas(page); // section 2 = "Canvas 2"
  // Put a marker into Canvas 1 so an overwrite is detectable.
  const sheet1 = page.locator('#paper .canvas-sheet').nth(0);
  await sheet1.scrollIntoViewIfNeeded();
  const box = await sheet1.boundingBox();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.3);
  await page.keyboard.type('CANVAS-1-MARKER');
  await page.waitForTimeout(300);
  const beforeImport = await readDoc(page);
  console.log('BEFORE kinds=', JSON.stringify(beforeImport.sections.map((s) => s.kind ?? 'flow')), 'canvas1 text=', JSON.stringify(summarize(beforeImport)[1]?.content?.text));
  const canvas2IdBefore = beforeImport.sections[2].id;
  await selectPage(page, 2);
  await page.screenshot({ path: path.join(artifactDir, `${prefix}-${label}-1-canvas2-selected.png`) });
  await importFile(page, path.join(fixtureDir, fixtureFile));
  const doc = await readDoc(page);
  assert.equal(await page.locator('.canvas-sheet-label').count(), 0, 'paper must not show technical Canvas size labels');
  assert.equal(await page.locator('.paper .drag-region-label:visible').count(), 0, 'editor instructions must not be displayed over the paper');
  const importedHeader = page.locator('#paper > .canvas-sheet[data-page-section="' + canvas2IdBefore + '"] .canvas-header-layer').first();
  if (await importedHeader.count()) {
    const headerGeometry = await importedHeader.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const images = [...el.querySelectorAll('img')].map((img) => img.getBoundingClientRect().bottom);
      return { bottom: r.bottom, border: getComputedStyle(el).borderBottomWidth, imageBottom: Math.max(0, ...images), hasContent: el.children.length > 0 };
    });
    if (headerGeometry.imageBottom > 0) assert.ok(headerGeometry.bottom >= headerGeometry.imageBottom - 1, 'header region must extend below header images');
  }
  const importedTarget = doc.sections.find((section) => section.id === canvas2IdBefore);
  assert.ok(importedTarget, 'the selected Canvas 2 section identity must survive import');
  const hasExplicitHeaderRule = (importedTarget.header || []).some((block) => block.type === 'horizontalRule');
  const visibleHeaderRules = await importedHeader.locator('hr').count();
  if (hasExplicitHeaderRule) assert.ok(visibleHeaderRules > 0, 'an explicitly imported header rule must remain visible below the letterhead');
  else assert.equal(await importedHeader.evaluate((el) => Number.parseFloat(getComputedStyle(el).borderBottomWidth)), 0, 'an empty/decorative header rule must not be invented when the imported document has no line');
  assert.match(JSON.stringify(importedTarget), /SURAT DINAS|DOKUMEN PANJANG/, 'the imported content must be stored in the selected Canvas');
  assert.deepEqual(doc.sections[1], beforeImport.sections[1], 'Canvas 1 must remain unchanged by import');
  console.log('STATUS:', await readStatus(page));
  console.log('AFTER sections=', doc.sections.length, 'kinds=', JSON.stringify(doc.sections.map((s) => s.kind ?? 'flow')), 'canvas2 id unchanged=', doc.sections.some((s) => s.id === canvas2IdBefore));
  if (label === 'json-single' || label === 'docx' || label === 'dotx') {
    const positionedUnnecessarily = await page.locator('#paper > .canvas-sheet[data-page-section="' + canvas2IdBefore + '"] .canvas-image-box').count();
    assert.equal(positionedUnnecessarily, 0, 'imported images without explicit coordinates must stay in normal document flow');
  }
  assert.deepEqual(duplicateIds(doc), [], 'the imported document must have globally unique IDs');
  console.log('DUPLICATE IDS:', JSON.stringify(duplicateIds(doc)));
  summarize(doc).forEach((s) => console.log('  ', JSON.stringify(s)));
  const layout = await measureLayout(page);
  assert.equal(layout.scroller.overflowsX, false, 'Canvas pages must fit the preview width without horizontal overflow');
  if (layout.sheets.length && !(summarize(doc)[0]?.content?.text || '').trim()) assert.ok(Math.abs(layout.sheets[0].yInPaper) <= 1, 'first Canvas must align with the physical page top when the leading default section is empty; y=' + layout.sheets[0].yInPaper);
  for (const sheet of layout.sheets) {
    assert.ok(Math.abs(sheet.xInPaper) <= 1, 'Canvas ' + sheet.sectionId + ' must align with the page left edge (x=' + sheet.xInPaper + ')');
    assert.ok(sheet.rightOverflowPx <= 1, 'Canvas ' + sheet.sectionId + ' must not overflow the page width (' + sheet.rightOverflowPx + 'px)');
    assert.equal(sheet.clippedContent, false, 'Canvas ' + sheet.sectionId + ' must not clip content');
    assert.equal(sheet.flowLayer?.overflowsLayer, false, 'Canvas ' + sheet.sectionId + ' body must fit its page');
  }
  if (label === 'docx-long') {
    const allContent = JSON.stringify(doc.sections);
    for (let i = 1; i <= 70; i++) assert.ok(allContent.includes('Paragraf ke-' + i + '.'), 'long document paragraph ' + i + ' must be preserved');
    assert.ok(allContent.includes('PARAGRAF-TERAKHIR'), 'the last paragraph must survive pagination');
    assert.ok(doc.sections.filter((section) => section.kind === 'canvas').length >= 4, 'long document should split into multiple Canvas pages');
  }
  if (label === 'docx') {
    await page.emulateMedia({ media: 'print' });
    const visiblePrintControls = await page.evaluate(() => [...document.querySelectorAll('.canvas-sheet-label,.box-handle,.box-resize,.top,.left,.right,.toolbar,footer')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.className || el.tagName));
    assert.deepEqual(visiblePrintControls, [], 'editor controls must be hidden in print media');
    const printPageWidth = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.body).width));
    assert.ok(Math.abs(printPageWidth - 793.7) < 2, 'print body width must be the 210mm A4 width at 96dpi');
    await page.screenshot({ path: path.join(artifactDir, 'print-preview-canvas.png'), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    for (const [selector, filename] of [['#exportdocx', 'canvas-export-verified.docx'], ['#exportpdf', 'canvas-export-verified.pdf']]) {
      const downloadPromise = page.waitForEvent('download');
      await page.locator(selector).click();
      const download = await downloadPromise;
      const output = path.join(artifactDir, filename);
      await download.saveAs(output);
      const stat = await fs.stat(output);
      assert.ok(stat.size > 100, filename + ' must be non-empty');
      console.log('EXPORT VERIFIED:', filename, stat.size, 'bytes');
    }
  }
  console.log('LAYOUT zoom=', layout.zoom, 'paper=', JSON.stringify(layout.paper), 'scroller=', JSON.stringify(layout.scroller));
  layout.sheets.forEach((s) => console.log('  SHEET', JSON.stringify(s)));
  const active = await page.locator('#pageIndicator').textContent();
  console.log('ACTIVE PAGE INDICATOR:', active);
  await page.locator('#paper .canvas-sheet').nth(1).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifactDir, `${prefix}-${label}-2-after-import.png`) });
  assert.deepEqual(errors, [], 'browser console/page errors must be empty');
  console.log('ERRORS:', JSON.stringify(errors));
  await context.close();
}

try {
  await scenario('json-multisection', 'fixture-multisection.json');
  await scenario('json-single', 'fixture-single.json');
  await scenario('docx', 'fixture-single.docx');
  await scenario('dotx', 'fixture-single.dotx');
  await scenario('docx-long', 'fixture-long.docx');
} finally {
  await browser.close();
  await server.close();
}
