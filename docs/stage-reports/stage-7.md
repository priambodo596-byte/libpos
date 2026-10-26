# Stage 7 — Pagination foundation

## Implemented

- Added framework-neutral `paginateDocument(document, measureBlock)` to `@convetlib/editor`.
- Uses page size and margins (twips) to calculate content width and height.
- Flows top-level blocks to new pages using host-supplied measured heights.
- Honors explicit `pageBreak` nodes, keeps each section on a separate page sequence, and resets section-local page numbering.
- Supports `attrs.keepWithNext: true`: if a block and its next block fit on a fresh page, they move together instead of leaving the first block stranded at the bottom of the current page.
- Returns page and block placement metadata, including source block ID, vertical offset, measured height, used content height, and overflow status.
- Rejects invalid page geometry and negative/non-finite measured heights.
- Oversized blocks are kept intact and marked as overflow instead of being silently split.

## Verification

- `pnpm run verify`: passed; **175 tests passed** across core, editor, UI, and templates packages; builds and typechecks passed.
- `packages/editor/test/pagination.test.ts`: 7 tests covering flow, explicit breaks, section boundaries, overflow, invalid inputs, and keep-with-next behavior.
- `git diff --check`: passed.

## Scope / remaining work

- This is a pagination foundation, not a full renderer or text layout engine. The host must supply accurate block heights based on font shaping, line wrapping, and rendering environment.
- Blocks are indivisible at this stage. Paragraph line splitting, widow/orphan rules, table row splitting/repeating headers, floats, footnotes, and header/footer rendering are not implemented.
- DOCX/PDF import/export and visual parity remain later stages.
- Next: deepen layout measurement contracts and pagination rules before starting DOCX/PDF pipelines.
