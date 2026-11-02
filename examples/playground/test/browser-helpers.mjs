// Browser helpers shared by the Canvas audit/regression scripts. Starts the playground through Vite and drives it with Playwright.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const playgroundRoot = path.resolve(here, '..');
export const repoRoot = path.resolve(here, '../../..');
export const artifactDir = path.join(repoRoot, 'artifacts', 'canvas-audit');
export const fixtureDir = path.join(artifactDir, 'fixtures');
fs.mkdirSync(artifactDir, { recursive: true });

const editorRequire = createRequire(path.join(repoRoot, 'packages/editor/package.json'));
const playgroundRequire = createRequire(path.join(playgroundRoot, 'package.json'));
const { chromium } = editorRequire('playwright');
const { createServer } = playgroundRequire('vite');

export async function startPlayground() {
  const server = await createServer({ root: playgroundRoot, server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error', clearScreen: false });
  await server.listen();
  const address = server.httpServer.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

export async function launchBrowser() {
  try { return await chromium.launch({ headless: true }); }
  catch (primary) {
    try { return await chromium.launch({ headless: true, channel: 'msedge' }); }
    catch { throw primary; }
  }
}

/** Opens a fresh playground page and records console errors / page errors. */
export async function openPlayground(browser, url, { width = 1600, height = 1000 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#paper');
  return { page, context, errors };
}

export const readDoc = (page) => page.evaluate(() => JSON.parse(document.getElementById('json').value));
export const readStatus = (page) => page.locator('#status').textContent();

export async function addCanvas(page) {
  await page.locator('[data-left="pages"]').click();
  await page.locator('#addCanvas').click();
  await page.waitForTimeout(250);
}

export async function selectPage(page, index) {
  await page.locator('[data-left="pages"]').click();
  await page.locator(`#pageList .page-card[data-page-index="${index}"]`).click();
  await page.waitForTimeout(250);
}

export async function importFile(page, filePath) {
  await page.setInputFiles('#file', filePath);
  await page.waitForTimeout(700);
}

/** Geometry of the paper and every canvas sheet, in CSS px of the scaled (zoomed) viewport and relative to the paper. */
export function measureLayout(page) {
  return page.evaluate(() => {
    const paper = document.getElementById('paper');
    const pr = paper.getBoundingClientRect();
    const scroller = paper.closest('.canvas');
    const sr = scroller.getBoundingClientRect();
    const cs = getComputedStyle(paper);
    const round = (v) => Math.round(v * 10) / 10;
    return {
      zoom: paper.style.zoom,
      paper: { x: round(pr.x), y: round(pr.y), w: round(pr.width), h: round(pr.height), styleWidth: paper.style.width, padding: cs.padding },
      scroller: { x: round(sr.x), w: round(sr.width), scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth, overflowsX: scroller.scrollWidth > scroller.clientWidth + 1 },
      sheets: [...paper.querySelectorAll('.canvas-sheet')].map((sheet) => {
        const r = sheet.getBoundingClientRect();
        const flow = sheet.querySelector('.canvas-flow-layer');
        const fr = flow?.getBoundingClientRect();
        return {
          sectionIndex: sheet.dataset.sectionIndex, sectionId: sheet.dataset.pageSection,
          xInPaper: round(r.x - pr.x), yInPaper: round(r.y - pr.y), w: round(r.width), h: round(r.height),
          rightOverflowPx: round(r.right - pr.right),
          styleWidth: sheet.style.width, styleHeight: sheet.style.height,
          clippedContent: sheet.scrollHeight > sheet.clientHeight + 1, scrollHeight: sheet.scrollHeight, clientHeight: sheet.clientHeight,
          flowLayer: flow ? { x: round(fr.x - r.x), y: round(fr.y - r.y), w: round(fr.width), h: round(fr.height), scrollHeight: flow.scrollHeight, overflowsLayer: flow.scrollHeight > flow.clientHeight + 1 } : null,
          images: [...sheet.querySelectorAll('.canvas-image-box')].map((box) => { const b = box.getBoundingClientRect(); return { id: box.dataset.blockId, x: round(b.x - r.x), y: round(b.y - r.y), w: round(b.width), h: round(b.height) }; }),
        };
      }),
    };
  });
}
