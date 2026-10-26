# Stage 8 — DOCX export foundation

## Implemented

- Added optional package `@convetlib/docx` using the `docx` OOXML library.
- Exposes `exportDocx(document, options?)` and returns a DOCX byte array.
- Converts document sections and page geometry, paragraphs, headings, text marks (bold, italic, underline, strike, superscript, subscript), placeholders, page breaks, basic lists, and simple tables.
- Supports host-provided image resolution via `resolveImage`; the host returns image bytes and an explicit raster format. The exporter does not fetch remote resources implicitly.
- If an image resolver is not supplied, exports a readable alt-text placeholder rather than silently dropping the image.
- Added tests verifying a generated DOCX byte stream, ZIP signature, image fallback, and invalid-document handling.

## Verification

- `pnpm --filter @convetlib/docx test`: 3 tests passed.
- `pnpm --filter @convetlib/docx typecheck`: passed.
- `pnpm --filter @convetlib/docx build`: passed.
- Full workspace `pnpm run verify`: passed; **178 tests passed** across core, editor, UI, templates, and DOCX packages.

## Scope / remaining work

- This is semantic DOCX export, not pixel-perfect HTML/CSS rendering.
- Header/footer nodes, advanced paragraph spacing/indentation, full list numbering definitions, merged table cells, row pagination rules, comments/revisions, and embedded-object support are not implemented yet.
- DOCX import is not implemented in this stage.
- Image loading is host-provided intentionally; the exporter will not fetch arbitrary remote URLs itself.
- Next: add round-trip/import tests and improve style/table fidelity, then build the PDF export foundation.
