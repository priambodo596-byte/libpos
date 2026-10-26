# Stage 7 — Pagination foundation

## Implemented

- Added framework-neutral `paginateDocument(document, measureBlock)` to `@convetlib/editor`.
- Uses the document section's page size and margins (twips) to calculate content width and height.
- Flows top-level blocks to new pages using host-supplied measured heights.
- Honors explicit `pageBreak` nodes, keeps each section on a separate page sequence, and resets section-local page numbering.
- Returns page and block placement metadata, including source block ID, vertical offset, measured height, used content height, and overflow status.
- Rejects invalid page geometry and negative, non-finite measured heights.
- Oversized blocks are kept intact and marked as overflow instead of being silently split.

## Verification

- `pnpm run verify`: passed; 173 tests passed across core, editor, UI, and templates packages; builds and typechecks passed.
- `packages/editor/test/pagination.test.ts`: 5 tests covering flow, explicit breaks, section boundaries, overflow, and invalid inputs.
- `git diff --check`: passed.

## Scope / remaining work

- This is a pagination foundation, not a full renderer or text layout engine. The host must supply accurate block heights based on its font shaping, line wrapping, and rendering environment.
- Blocks are indivisible at this stage. Paragraph line splitting, keep-with-next/widow-orphan rules, table row splitting/repeating headers, floats, footnotes, and header/footer rendering are not implemented.
- DOCX/PDF import/export and visual parity remain later stages.
- Next: deepen layout measurement contracts and pagination rules before starting DOCX/PDF pipelines.
