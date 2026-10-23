import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const server = await createServer({ root, configFile: false, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/packages/editor/test/browser-fixture.html`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.editorHarness));
  const text = () => page.evaluate(() => window.editorHarness.getText());

  // The adapter publishes the minimum textbox semantics and host-provided accessible name.
  assert.equal(await page.locator("#editor").getAttribute("role"), "textbox");
  assert.equal(await page.locator("#editor").getAttribute("aria-multiline"), "true");
  assert.equal(await page.locator("#editor").getAttribute("aria-labelledby"), "editor-label");
  const require = createRequire(import.meta.url);
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const a11y = await page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
  });
  assert.deepEqual(a11y, [], `Accessibility violations: ${JSON.stringify(a11y)}`);

  // DOM selection must map to the model before native beforeinput text insertion.
  await page.evaluate(() => window.editorHarness.select(0, 5));
  await page.locator("#editor").click();
  await page.evaluate(() => window.editorHarness.select(0, 5));
  await page.keyboard.insertText("!");
  await page.waitForFunction(() => window.editorHarness.getText()[0] === "Hello! world");
  assert.deepEqual(await text(), ["Hello! world", "Second line"]);

  // Native browser copy/paste path: selected text is exposed through the system clipboard.
  await page.evaluate(() => window.editorHarness.select(0, 0, 5));
  await page.keyboard.press("Control+C");
  await page.waitForTimeout(50);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(copied, "Hello");

  // Cut uses the clipboard event and updates the document model rather than leaving native DOM edits.
  await page.evaluate(() => window.editorHarness.select(1, 0, 6));
  await page.keyboard.press("Control+X");
  await page.waitForFunction(() => window.editorHarness.getText()[1] === " line");
  assert.deepEqual(await text(), ["Hello! world", " line"]);

  // Paste back into a real contenteditable root.
  await page.evaluate(async () => { await navigator.clipboard.writeText("Second"); window.editorHarness.select(1, 0); });
  await page.keyboard.press("Control+V");
  await page.waitForFunction(() => window.editorHarness.getText()[1] === "Second line");
  assert.deepEqual(await text(), ["Hello! world", "Second line"]);

  // Composition event ordering is tested at the browser event boundary; this does not emulate an OS IME.
  await page.evaluate(() => {
    window.editorHarness.select(0, 0);
    const root = window.editorHarness.root;
    root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertCompositionText", data: "日", isComposing: true }));
    root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日" }));
  });
  await page.waitForFunction(() => window.editorHarness.getText()[0] === "日Hello! world");
  assert.deepEqual(await text(), ["日Hello! world", "Second line"]);

  // Cross-block DOM selection maps to the model; Backspace performs the supported structural deletion.
  await page.evaluate(() => {
    const blocks = window.editorHarness.root.querySelectorAll("[data-block-id]");
    const a = blocks[0].firstChild, b = blocks[1].firstChild;
    const native = document.getSelection();
    native.setBaseAndExtent(a, 1, b, 2);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.waitForFunction(() => window.editorHarness.modelSelection()?.anchor.blockId !== window.editorHarness.modelSelection()?.head.blockId);
  await page.locator("#editor").press("Backspace");
  await page.waitForFunction(() => window.editorHarness.getText().length === 1 && window.editorHarness.getText()[0] === "日cond line");
  assert.deepEqual(await text(), ["日cond line"]);

  // Inline atoms count as one model position even though their rendered label has arbitrary DOM.
  const atomId = await page.evaluate(() => window.editorHarness.addAtomBlock());
  await page.evaluate(id => window.editorHarness.selectAtomTailStart(id), atomId);
  await page.waitForFunction(id => window.editorHarness.modelSelection()?.anchor.blockId === id && window.editorHarness.modelSelection()?.anchor.offset === 5, atomId);
  await page.keyboard.insertText("X");
  await page.waitForFunction(() => window.editorHarness.getText()[1] === "Atom\uFFFCXTail");
  assert.deepEqual(await text(), ["日cond line", "Atom\uFFFCXTail"]);
  assert.deepEqual(errors, []);

  await page.evaluate(() => window.editorHarness.dispose());
  console.log("Browser integration passed: axe accessibility baseline, text and inline-atom selection mapping, typing, native clipboard copy/cut/paste, synthetic composition ordering, cross-block structural deletion.");
} finally {
  if (browser) await browser.close();
  await server.close();
}
