# Stage 11 - PDF headers, footers, and page numbering

## Implemented

- Added optional repeating `header` and `footer` text to `PdfExportOptions`.
- Added optional `pageNumbering` default footer (`Page N of M`).
- Custom header/footer strings support `{{pageNumber}}` and `{{pageCount}}` tokens, resolved after pagination so the total page count is accurate.
- Header/footer text is drawn on every generated page, including pages added for overflow and explicit page breaks.
- Added a test covering two-page documents with repeating header/footer settings.

## Verification

- `pnpm --filter @convetlib/pdf test`: 5 tests passed.
- `pnpm --filter @convetlib/pdf typecheck`: passed.
- `pnpm --filter @convetlib/pdf build`: passed.
- Full workspace `pnpm run verify`: passed; **183 tests passed** across core, editor, UI, templates, DOCX, and PDF.

## Scope / remaining work

- Header/footer content is plain text using standard Helvetica; rich text, images, alignment options, and header/footer-specific rules per section are not included.
- Page numbering is global across all generated pages in the PDF.
- Custom font embedding, richer inline text styling, advanced table layout, and accessibility tagging remain future work.

