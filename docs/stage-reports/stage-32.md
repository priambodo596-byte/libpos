# Stage 32 — DOCX merged table cells (export + import consistency)

## Bugs fixed

1. `exportDocx` dropped `colspan`/`rowspan` entirely: merged cells were exported as plain cells, and `tblGrid` was guessed from the first row, so tables with merges lost their structure and could shift columns. Export now places cells on a column grid (accounting for columns held by a `rowspan` from earlier rows), emits `gridSpan` and `vMerge restart/continue`, and declares the correct column count.
2. Invalid span values (0, negative, non-integer, `rowspan` beyond remaining rows, `colspan` above 100) are clamped instead of producing a corrupt table.
3. `importDocx` kept counting a vertical merge across a row made only of continuation cells, even though that row is not emitted, so the merge claimed a row that holds another cell. The rowspan is now decremented for such dropped rows.

## Tests (`packages/docx/test/*.test.ts`, "DOCX merged table cells")

Round-trip of colspan + rowspan, OOXML markup (`gridSpan`, `vMerge restart/continue`), clamping of invalid spans, and the all-continuation-row import case.

## Verification

`pnpm run verify` passed: core 107, editor 78, DOCX 24, PDF 14, templates 6, UI 4. `git diff --check` clean. Browser integration tests were not run.

## Limitations (still open)

- Only spans are round-tripped on export. Cell width, shading, borders and vertical alignment that import reads are still not written back by export.
- PDF export (`packages/pdf`, `tableRows`) still ignores `colspan`/`rowspan`, so merged cells shift columns in PDF. Not touched here.
- No real-world Word fixtures were added; tests use generated documents.
- Not verified in Microsoft Word itself.
