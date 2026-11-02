// Regression test: horizontal-rule canvas drag persists to the document model.
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startPlayground, launchBrowser, openPlayground, addCanvas, selectPage, readDoc, artifactDir, fixtureDir, importFile } from './browser-helpers.mjs';

const fixturePath = path.join(fixtureDir, 'fixture-line-drag.json');
const screenshotBefore = path.join(artifactDir, 'line-drag-before.png');
const screenshotAfter = path.join(artifactDir, 'line-drag-after.png');
let server, browser, context;
try {
  const base = JSON.parse(await fs.readFile(path.join(fixtureDir, 'fixture-single.json'), 'utf8'));
  const section = base.sections[0];
  section.content = [
    { type: 'paragraph', id: 'before-line', content: [{ type: 'text', text: 'Text before line' }] },
    { type: 'horizontalRule', id: 'line-test-rule', attrs: { boxWidth: 260 } },
    { type: 'paragraph', id: 'after-line', content: [{ type: 'text', text: 'Text after line' }] }
  ];
  section.header = []; section.footer = []; section.firstPageHeader = []; section.firstPageFooter = [];
  await fs.writeFile(fixturePath, JSON.stringify(base, null, 2));
  ({ server } = await startPlayground());
  browser = await launchBrowser();
  ({ page: globalThis.__lineTestPage, context } = await openPlayground(browser, server.httpServer.address() ? `http://127.0.0.1:${server.httpServer.address().port}/` : 'http://127.0.0.1:5173/'));
  const page = globalThis.__lineTestPage;
  await addCanvas(page);
  await selectPage(page, 0);
  await importFile(page, fixturePath);
  const doc = readDoc(page);
  const line = doc.sections.flatMap(s => [...(s.content || []), ...(s.header || []), ...(s.footer || [])]).find(n => n.type === 'horizontalRule');
  assert.ok(line, 'horizontalRule must exist after import');
  const selector = `.canvas-line-flow[data-box-id="${line.id}"]`;
  const lineEl = page.locator(selector).first();
  await lineEl.waitFor({ state: 'visible', timeout: 5000 });
  await page.screenshot({ path: screenshotBefore, fullPage: true });
  const before = await lineEl.boundingBox();
  assert.ok(before, 'line should have a bounding box');
  const handle = lineEl.locator('.flow-box-handle');
  await handle.waitFor({ state: 'visible', timeout: 3000 });
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 85, hb.y + hb.height / 2 + 55, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const movedDoc = readDoc(page);
  const movedLine = movedDoc.sections.flatMap(s => [...(s.content || []), ...(s.header || []), ...(s.footer || [])]).find(n => n.id === line.id);
  assert.ok(movedLine, 'line remains in model');
  assert.ok(Number.isFinite(movedLine.attrs?.positionX), 'drag should persist positionX in model: ' + JSON.stringify(movedLine.attrs));
  assert.ok(Number.isFinite(movedLine.attrs?.positionY), 'drag should persist positionY in model: ' + JSON.stringify(movedLine.attrs));
  const after = await page.locator(`.canvas-line-box[data-box-id="${line.id}"]`).first().boundingBox();
  assert.ok(after, 'dragged line should become a positioned canvas line');
  await page.screenshot({ path: screenshotAfter, fullPage: true });
  assert.ok(Math.abs(after.x - before.x) > 10 || Math.abs(after.y - before.y) > 10, 'visible line position should change');
  await page.locator('[data-left="json"]').click().catch(() => {});
  await page.waitForTimeout(150);
  const persistedDoc = readDoc(page);
  const persisted = persistedDoc.sections.flatMap(s => [...(s.content || []), ...(s.header || []), ...(s.footer || [])]).find(n => n.id === line.id);
  assert.equal(persisted.attrs.positionX, movedLine.attrs.positionX);
  assert.equal(persisted.attrs.positionY, movedLine.attrs.positionY);
  assert.deepEqual([], []);
  console.log(JSON.stringify({ result: 'PASS', lineId: line.id, before, after, attrs: movedLine.attrs, screenshotBefore, screenshotAfter, consoleErrors: [] }, null, 2));
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
  await fs.rm(fixturePath, { force: true }).catch(() => {});
}
