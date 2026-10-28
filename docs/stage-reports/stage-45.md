# Stage 45 — PDF pagination for exceptionally tall table rows

## Changes
- PDF export now splits a single table row across page-sized continuation fragments when its wrapped content is taller than the usable page height.
- Each continuation fragment keeps cell borders and continues the corresponding wrapped text lines; content is no longer drawn past the page boundary merely because the row is too tall to fit.
- Row groups that contain rowspans remain intact, so this behavior only applies to a single-row group with no rowspan crossing the row boundary.
- Added a regression test with a 900-token cell that verifies multi-page output and confirms the beginning and end of the cell text are rendered.

## Verification
- `pnpm --filter @convetlib/pdf test`: passed, 23 tests.
- `pnpm run verify`: passed (build, typecheck, and all package tests), 260 tests total.
- `git diff --check`: passed before the full verification run.

## Remaining limitations
- This does not split a multi-row group joined by `rowspan`; those groups are kept together by design and an exceptionally tall merged group still needs a dedicated continuation strategy.
- Complex floating image overlaps and pixel-level parity between Word and PDF remain outside this fix.
- Exact Times New Roman appearance and broad Unicode coverage require supplying appropriate embedded font bytes.
