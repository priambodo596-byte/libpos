# Stage 13 - PDF table layout fidelity

## Implemented

- PDF tables accept an optional `columnWidths` array in table-node attributes. Values are relative positive weights, such as `[3, 1]`; missing or invalid values fall back to equal-width columns.
- Cell text wraps based on the individual column width and contributes to the row height, so multi-line cells receive additional vertical space.
- Table rows are moved to the next page when they do not fit in the remaining content area. The first row is repeated as a table header on continuation pages.
- Added regression tests for long table descriptions that wrap and tables with weighted column widths.

## Verification

- `pnpm --filter @convetlib/pdf test`: 9 tests passed.
- `pnpm --filter @convetlib/pdf typecheck`: passed.
- `pnpm --filter @convetlib/pdf build`: passed as part of workspace verification.
- Full workspace `pnpm run verify`: build and typecheck passed; all **187 tests passed** across core, editor, UI, templates, DOCX, and PDF. `git diff --check` passed.

## Scope / remaining work

- `columnWidths` is a relative-weight array, not absolute points or percentages.
- Table cells are wrapped, but a single row taller than the usable page area is not split across pages.
- Merged cells (`colspan`/`rowspan`), per-cell styling, table-level borders/shading, vertical alignment, and exact Word/HTML layout parity remain unsupported.
- Pagination remains a semantic renderer, not a browser layout engine.
