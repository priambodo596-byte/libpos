# Stage 12 - PDF custom fonts and inline text marks

## Implemented

- Added `@pdf-lib/fontkit` to support embedding and subsetting application-provided TrueType/OpenType font bytes.
- Added `fontBytes` and optional `boldFontBytes`, `italicFontBytes`, and `boldItalicFontBytes` options. Applications own font licensing and font asset delivery.
- PDF renderer now handles inline text runs in paragraphs/headings with bold, italic, underline, and strike marks; runs are measured and wrapped using the selected font.
- Unicode text is preserved for custom embedded font paths; standard Helvetica remains a WinAnsi-limited fallback and unsupported glyphs are replaced with `?`.
- Added tests for marked text rendering and clear validation when font variants are supplied without the base font.

## Verification

- `pnpm --filter @convetlib/pdf test`: 7 tests passed.
- `pnpm --filter @convetlib/pdf typecheck`: passed.
- `pnpm --filter @convetlib/pdf build`: passed.
- Full workspace `pnpm run verify`: passed; **185 tests passed** across core, editor, UI, templates, DOCX, and PDF.

## Scope / remaining work

- The host must provide licensed font bytes. Font selection by family name, automatic system-font discovery, and font fallback chains are not implemented.
- For complete Unicode and consistent emphasis, provide matching regular/bold/italic/bold-italic font files. Otherwise emphasis may fall back to standard fonts with limited glyph coverage.
- Rich runs currently cover bold, italic, underline, and strike; highlight colors, text color, superscript/subscript, links, inline layout and complex typography remain future work.

