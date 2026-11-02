// Diagnoses free typing on a blank Canvas: where does the click land, who is focused, does the model change?
import { startPlayground, launchBrowser, openPlayground, readDoc, addCanvas, artifactDir } from './browser-helpers.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { server, url } = await startPlayground();
const browser = await launchBrowser();
try {
  const { page, context, errors } = await openPlayground(browser, url);
  await addCanvas(page);
  const sheet = page.locator('#paper .canvas-sheet').first();
  await sheet.scrollIntoViewIfNeeded();
  const info = async (label) => {
    const state = await page.evaluate(() => {
      const a = document.activeElement;
      const sel = getSelection();
      const sheet = document.querySelector('#paper .canvas-sheet');
      return {
        active: a ? { tag: a.tagName, id: a.id, cls: a.className, ce: a.getAttribute('contenteditable'), blockId: a.dataset?.blockId ?? null } : null,
        selAnchor: sel?.anchorNode ? (sel.anchorNode.nodeType === 3 ? '#text' : sel.anchorNode.tagName + '.' + sel.anchorNode.className) : null,
        editableLeaves: [...sheet.querySelectorAll('[contenteditable="true"]')].map((el) => ({ tag: el.tagName, blockId: el.dataset.blockId, region: el.closest('[data-region]')?.dataset.region, html: el.innerHTML.slice(0, 60) })),
        sheetHtml: sheet.innerHTML.replace(/ style="[^"]*"/g, '').slice(0, 900),
      };
    });
    console.log(label, JSON.stringify(state, null, 1));
  };
  await info('INITIAL');
  const box = await sheet.boundingBox();
  // click in the body area, then in the header area, then in the footer area
  for (const [name, fx, fy] of [['body', 0.4, 0.3], ['header', 0.4, 0.05], ['footer', 0.4, 0.985]]) {
    if (name === 'footer') {
      const footer = sheet.locator('.canvas-footer-layer');
      await footer.scrollIntoViewIfNeeded();
      const regionBox = await footer.boundingBox();
      await page.mouse.click(regionBox.x + regionBox.width / 2, regionBox.y + regionBox.height / 2);
    } else {
      const currentBox = await sheet.boundingBox();
      await page.mouse.click(currentBox.x + currentBox.width * fx, currentBox.y + currentBox.height * fy);
    }
    await page.waitForTimeout(200);
    await page.keyboard.type('TYPED-' + name);
    await page.waitForTimeout(300);
    const doc = await readDoc(page);
    const s = doc.sections.find((x) => x.kind === 'canvas');
    const region = name === 'body' ? s.content : name === 'header' ? s.header : s.footer;
    const regionText = (region || []).map((block) => (block.content || []).map((node) => node.text || '').join('')).join('');
    assert.ok(regionText.includes('TYPED-' + name), 'typing in ' + name + ' must update that region in the document model');
    const dump = (nodes) => JSON.stringify((nodes || []).map((b) => (b.content || []).map((c) => c.text).join('')));
    console.log('AFTER CLICK ' + name + ': header=' + dump(s.header) + ' content=' + dump(s.content) + ' footer=' + dump(s.footer));
    await info('STATE after ' + name);
  }
  await page.screenshot({ path: path.join(artifactDir, 'diag-typing-blank-canvas.png') });
  assert.deepEqual(errors, [], 'typing must not produce browser errors');
  console.log('ERRORS', JSON.stringify(errors));
  await context.close();
} finally { await browser.close(); await server.close(); }
