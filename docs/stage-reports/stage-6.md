# Stage 6 — Structural clipboard fragments

## Implemented

- Clipboard payloads carry structural `BlockNode` fragments separately from plain text and inline text runs.
- Paste inserts image and table fragments as real document nodes, splitting the selected paragraph while preserving text before and after the insertion.
- Added a conservative HTML importer for mixed top-level paragraph/image/table sequences. It preserves the sequence and table row/cell/paragraph hierarchy for supported markup.
- The importer discards script/style/iframe/object/SVG/math content, ignores arbitrary HTML attributes, and only accepts image URLs using HTTP(S) or selected base64 image data URLs.
- Structural cloning assigns fresh IDs, limits nesting depth, validates table row/cell nesting, and rejects unsupported node types or unsafe image schemes.
- Tests cover mixed paragraph-image-table-paragraph imports, unsafe markup/source rejection, image insertion, table insertion, and surrounding text preservation.

## Verification

- `pnpm run verify`: passed; 168 tests passed across core, editor, UI, and templates packages; package builds and typechecks passed.
- `pnpm --filter @convetlib/editor test:browser:all`: passed Chromium, Firefox, and WebKit browser integration suites.
- `git diff --check`: passed.

## Scope / remaining work

- HTML parsing intentionally supports a limited allow-list. It is not a standards-complete HTML parser and does not promise fidelity for arbitrary malformed HTML, complex nested layouts, CSS, lists, or mixed content inside complex tables.
- Image binaries are not fetched or embedded automatically. Clipboard adapters must provide supported image URLs or data URLs; browser and remote resource policies may affect availability.
- Complex table spans, SVG, embedded objects, full HTML/CSS fidelity, native OS IME testing, and manual screen-reader audit remain out of scope for this increment.
- Next: layout/pagination foundations, then DOCX/PDF import/export, review workflows, and collaboration.
