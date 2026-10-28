# Stage 48 — Oversized merged table groups in PDF

## Scope
Handle table row groups taller than a physical PDF page, including groups joined by `rowspan`.

## Implementation
- The oversized-group continuation path now applies to any row group exceeding the usable page height, not only a single row.
- Cells belonging to the group are included in page-sized continuation fragments with borders, and their wrapped text is emitted across fragments rather than overflowing one page.
- Added a regression test with a two-row `rowspan` cell and companion cells; verifies multiple pages and that the beginning/end of merged content and both row labels are retained.

## Verification
- `pnpm --filter @convetlib/pdf test` — passed, 26 tests.
- Full monorepo verification and clean-diff checks are run for this stage before commit.

## Known limitation
Continuation fragments use page-sized borders for the oversized group; this is a robust overflow fallback, not full Word-like pagination fidelity for complex merged-cell geometry. Visual PDF screenshot review remains separate from automated regression assertions.
