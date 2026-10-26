# Stage 9 — PDF export foundation

## Implemented

- Added optional package `@convetlib/pdf` using `pdf-lib`.
- Exposes `exportPdf(document, options?)` and returns PDF bytes.
- Renders section page sizes/margins, paragraphs, headings, explicit page breaks, simple tables, horizontal rules, and automatic page overflow.
- Includes title metadata and configurable body font size / paragraph gap.
- Uses standard Helvetica fonts for a minimal dependency surface; unsupported glyphs are replaced until custom font embedding is implemented.
- Added tests for valid PDF signature, metadata, page breaks, automatic pagination, and invalid input.

## Verification

- `pnpm --filter @convetlib/pdf test`: 3 tests passed.
- `pnpm --filter @convetlib/pdf typecheck`: passed.
- `pnpm --filter @convetlib/pdf build`: passed.
- Full workspace `pnpm run verify`: passed; **181 tests passed** across core, editor, UI, templates, DOCX, and PDF packages.

## Scope / remaining work

- This is a semantic text-first PDF renderer, not pixel-perfect HTML/CSS rendering.
- Images currently render as alt-text placeholders; embedded images, custom font embedding, mixed inline styles, headers/footers, links, page numbering, and accessibility tagging are not implemented.
- Tables are basic grids without merged cells, repeated headers, or row-splitting rules.
- Next: improve fonts/image embedding and align DOCX/PDF rendering rules.
