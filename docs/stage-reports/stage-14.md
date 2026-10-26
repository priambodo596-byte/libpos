# Stage 14 - DOCX import foundation

## Implemented

- Added `importDocx(bytes, options?)` to `@convetlib/docx`; accepts `Uint8Array` or `ArrayBuffer` and returns Convetlib `DocumentJSON`.
- Reads the DOCX ZIP package and parses `word/document.xml` plus internal document relationships. XML parse failures and missing required parts are reported as errors.
- Converts common paragraphs, built-in Heading 1â€“6 styles, bold/italic/underline/strike/superscript/subscript marks, simple tables, basic paragraph alignment, and section page geometry.
- Recognizes supported raster image relationships but emits a readable `[Imported image]` text placeholder; image extraction into editable image nodes is not yet implemented.
- Adds input byte, XML part, archive entry, and image byte limits. External relationships are skipped and relationship paths containing parent-directory segments are rejected.
- Added round-trip import coverage and invalid-input/size-limit tests.

## Verification

- `pnpm --filter @convetlib/docx test`: 5 tests passed.
- `pnpm --filter @convetlib/docx typecheck`: passed.
- `pnpm --filter @convetlib/docx build`: passed.
- Full workspace `pnpm run verify`: passed; all **189 tests passed** across core, editor, UI, templates, DOCX, and PDF. Build and typecheck passed. `git diff --check` passed.

## Scope / remaining work

- Lists and numbering definitions, custom style resolution, headers/footers, multi-section fidelity, editable image extraction, hyperlinks, fields, comments/revisions, merged cells, floating objects, and exact Word layout parity are not implemented.
- This is a semantic import foundation. Complex or unsupported OOXML may be simplified or omitted; consumers should validate imported content before saving or publishing it.

