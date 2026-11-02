// Pure (DOM-free) import planning for Canvas pages. Kept separate from pages-canvas.js so the policy can be unit-tested
// against the document model without a browser.
//
// Import policy (see README "Canvas import"):
//  1. The FIRST source section replaces the content of the active canvas: header, body, footer and all first/even-page
//     variants (an empty array is a meaningful "blank variant" and is kept), plus its page setup.
//  2. Further source sections are NOT merged into that canvas. They are inserted as their own sections directly after it,
//     so their headers, footers, tables and page setup stay attached to the content they belong to.
//  3. Every node and section id coming from the source is re-allocated from one allocator that knows every id of the
//     resulting document (all regions, variants and nested nodes), so repeated imports can never create duplicates.
//  4. Every other section of the current document is left untouched.

export const REGIONS = ['header', 'content', 'footer', 'firstPageHeader', 'firstPageFooter', 'evenPageHeader', 'evenPageFooter'];

const clone = (value) => JSON.parse(JSON.stringify(value));

function walkNodes(nodes, visit) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    visit(node);
    if (Array.isArray(node.content)) walkNodes(node.content, visit);
  }
}

/** Every id in the document: sections plus all nodes of all seven regions (nested nodes included). */
export function collectUsedIds(doc) {
  const used = new Set();
  for (const section of doc?.sections || []) {
    if (section?.id) used.add(section.id);
    for (const region of REGIONS) walkNodes(section?.[region], (node) => { if (node.id) used.add(node.id); });
  }
  return used;
}

/**
 * Returns a function that yields ids never present in `doc` (or handed out before). `generate` is the host's id factory.
 * A generator that keeps returning used ids is a bug, so the loop is bounded instead of hanging the page.
 */
export function createIdAllocator(doc, generate, extraUsed = []) {
  const used = collectUsedIds(doc);
  for (const id of extraUsed) used.add(id);
  const next = () => {
    for (let attempt = 0; attempt < 10000; attempt++) {
      const id = generate();
      if (typeof id === 'string' && id && !used.has(id)) { used.add(id); return id; }
    }
    throw new Error('Id generator did not produce a unique id');
  };
  /** Claims an existing id (returns false when it is already taken) so kept ids and generated ids share one namespace. */
  next.reserve = (id) => { if (typeof id !== 'string' || !id || used.has(id)) return false; used.add(id); return true; };
  next.has = (id) => used.has(id);
  return next;
}

/** Deep-copies a section and gives the section and every node inside it a fresh id. */
export function cloneSectionWithFreshIds(section, nextId) {
  const copy = clone(section);
  copy.id = nextId();
  for (const region of REGIONS) walkNodes(copy[region], (node) => { if (node.id) node.id = nextId(); });
  return copy;
}

/**
 * Plans an import into the canvas whose section id is `targetSectionId`.
 * Returns { doc, targetSectionId, targetIndex, addedSectionIds } or null when the target is not an existing canvas.
 * Never mutates its inputs.
 */
export function planCanvasImport(current, imported, targetSectionId, generate) {
  if (!Array.isArray(current?.sections) || !Array.isArray(imported?.sections) || imported.sections.length === 0) return null;
  const targetIndex = current.sections.findIndex((section) => section.id === targetSectionId);
  if (targetIndex < 0 || current.sections[targetIndex].kind !== 'canvas') return null;

  const doc = clone(current);
  const nextId = createIdAllocator(doc, generate);
  const target = doc.sections[targetIndex];
  const [first, ...rest] = imported.sections;

  const source = cloneSectionWithFreshIds(first, nextId);
  for (const region of REGIONS) delete target[region];
  for (const region of REGIONS) if (source[region] !== undefined) target[region] = source[region];
  // header/footer: "no blocks" and "unset" mean the same thing, while an empty first/even variant means "blank" and stays.
  if (Array.isArray(target.header) && target.header.length === 0) delete target.header;
  if (Array.isArray(target.footer) && target.footer.length === 0) delete target.footer;
  if (!Array.isArray(target.content) || target.content.length === 0) target.content = [{ type: 'paragraph', id: nextId(), content: [] }];
  if (first.page) target.page = clone(first.page);
  target.kind = 'canvas';

  const added = rest.map((section) => {
    const copy = cloneSectionWithFreshIds(section, nextId);
    if (!Array.isArray(copy.content) || copy.content.length === 0) copy.content = [{ type: 'paragraph', id: nextId(), content: [] }];
    return copy;
  });
  doc.sections.splice(targetIndex + 1, 0, ...added);

  // Comment/revision records referenced by imported text marks travel with it; records that already exist are kept as they are.
  for (const key of ['comments', 'revisions']) {
    const incoming = imported[key];
    if (!incoming || typeof incoming !== 'object') continue;
    doc[key] = doc[key] || {};
    for (const [id, value] of Object.entries(incoming)) if (!(id in doc[key])) doc[key][id] = clone(value);
  }
  return { doc, targetSectionId: target.id, targetIndex, addedSectionIds: added.map((section) => section.id) };
}

const isBlankParagraph = (node) => node?.type === 'paragraph' && !(node.content || []).some((child) => (child.type === 'text' && String(child.text || '').trim()) || child.type === 'placeholder' || child.id);

export function isBlankCanvas(section) {
  if (section?.kind !== 'canvas') return false;
  if (Array.isArray(section.header) && section.header.length) return false;
  if (Array.isArray(section.footer) && section.footer.length) return false;
  for (const region of ['firstPageHeader', 'firstPageFooter', 'evenPageHeader', 'evenPageFooter']) if (section[region] !== undefined) return false;
  const content = section.content || [];
  return content.length === 0 || (content.length === 1 && isBlankParagraph(content[0]));
}

/**
 * Used when the active page is not a canvas: the import replaces the document, but canvases the user just created (still blank)
 * are carried over after the imported sections instead of being lost. Ids are kept when free, re-allocated on collision.
 */
export function preserveBlankCanvases(current, imported, generate) {
  if (!Array.isArray(imported?.sections) || !Array.isArray(current?.sections)) return imported;
  const result = clone(imported);
  const nextId = createIdAllocator(result, generate);
  const importedIds = new Set(imported.sections.map((section) => section.id));
  const keepOrRefresh = (id) => (nextId.reserve(id) ? id : nextId());
  for (const section of current.sections) {
    if (!isBlankCanvas(section) || importedIds.has(section.id)) continue;
    const kept = clone(section);
    kept.id = keepOrRefresh(kept.id);
    for (const region of REGIONS) walkNodes(kept[region], (node) => { if (node.id) node.id = keepOrRefresh(node.id); });
    result.sections.push(kept);
  }
  return result;
}
