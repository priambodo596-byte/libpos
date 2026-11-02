import assert from 'node:assert/strict';
import path from 'node:path';
import { startPlayground, launchBrowser, openPlayground, readDoc, addCanvas, artifactDir } from './browser-helpers.mjs';

const { server, url } = await startPlayground();
const browser = await launchBrowser();
try {
  const { page, context, errors } = await openPlayground(browser, url);
  await addCanvas(page);
  let doc = await readDoc(page);
  assert.equal(doc.sections.length, 2, 'test setup should have the default section and one new Canvas');
  await page.locator('[data-left="pages"]').click();
  const firstPage = page.locator('#pageList .page-card').first();
  page.once('dialog', (dialog) => dialog.accept());
  await firstPage.locator('.page-card-del').click();
  await page.waitForTimeout(300);
  doc = await readDoc(page);
  assert.equal(doc.sections.length, 1, 'the default empty section should be deletable');
  assert.equal(doc.sections[0].kind, 'canvas', 'deleting the default section must preserve the user Canvas');
  assert.equal(await page.locator('#paper > .canvas-sheet').count(), 1, 'the remaining Canvas should still render');
  await page.screenshot({ path: path.join(artifactDir, 'default-page-deleted.png'), fullPage: true });
  assert.deepEqual(errors, [], 'deleting the default page must not produce browser errors');
  console.log('PASS: empty default page deleted; user Canvas preserved; no browser errors');
  await context.close();
} finally {
  await browser.close();
  await server.close();
}
