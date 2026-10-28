# Stage 33 — PDF merged table cells

## Bug fixed

`exportPdf` flattened tables into `string[][]` per row and ignored `colspan`/`rowspan`, so merged cells shifted every following cell into the wrong column (the model stores no continuation cells for `rowspan`).

## Change

- New pure module `packages/pdf/src/table-layout.ts` (no pdf-lib dependency): `buildTableGrid` (places cells on a column grid around columns held by a rowspan, clamps invalid spans), `computeRowHeights` (a tall merged cell grows only its last spanned row), `rowGroups` (rows joined by a rowspan form one unit).
- `exportPdf` now draws a merged cell as one rectangle spanning its columns/rows, wraps text to the spanned width, and still draws empty bordered cells for ragged rows.
- Pagination works on row groups: a rowspan never crosses a page break, and the first group is repeated as the header on continuation pages (same rule as before, applied to groups).

## Tests (`packages/pdf/test/table-layout.test.ts`)

Grid placement, span clamping, row-height growth, row grouping, rectangle geometry of a merged cell (fails on the previous renderer), and a multi-page table with rowspans (stays inside the bottom margin, header repeated). The multi-page test is a regression guard; it also passes on the previous renderer.

## Verification

`pnpm run verify` passed: core 107, editor 78, DOCX 24, PDF 20, templates 6, UI 4. `git diff --check` clean. Browser integration tests were not run.

## Limitations (still open)

- A row group taller than a page is still drawn on a fresh page and overflows the bottom margin; rows and merged cells are not split across pages.
- Cell text is plain (`nodeText`): no inline marks, images, nested blocks or cell borders/shading from the model in table cells.
- Vertical alignment is top only. Not compared against Word or other PDF renderers.
