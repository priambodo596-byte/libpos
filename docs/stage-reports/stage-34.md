# Stage 34 — DOCX table cell and row properties on export

## Bug fixed

`importDocx` reads cell width, shading, vertical alignment, borders and row height, but `exportDocx` wrote none of them back, so any table styling was lost on a round trip (and `tblGrid` ignored explicit cell widths).

## Change (`packages/docx/src/index.ts`)

- `cellProperties` writes `width` (dxa), `backgroundColor` (`w:shd`), `verticalAlign`, and `borderTop/Right/Bottom/Left` (`none` or `<px>px <solid|dashed|dotted|double> #rrggbb`, mapped to `sz` in eighths of a point and clamped to the valid 2..96 range).
- Row `height` is written as an "at least" row height.
- Table grid columns keep the explicit width of a colspan-1 cell when one exists; other columns share the remaining width.
- Malformed values (negative width, non-hex colors, unknown alignment, unparsable borders) are skipped rather than written as invalid OOXML. Hex case is preserved so values round-trip unchanged.

## Tests ("DOCX table cell and row properties")

Round-trip of width/shading/alignment/all four borders, round-trip of row height, and malformed or oversized values. All three failed before the change.

## Verification

`pnpm run verify` passed: core 107, editor 78, DOCX 27, PDF 20, templates 6, UI 4. `git diff --check` clean. Browser integration tests were not run.

## Limitations (still open)

- Table-level `width` and `layout` attributes are still not exported (tables are written at 100% width).
- Border sizes are limited to 0.33px..16px; `wave` and other exotic border styles are not represented.
- Explicit widths are used as given: if they sum to more than the text width, Word decides how to fit them.
- PDF export still ignores these cell properties. Not verified in Microsoft Word.
