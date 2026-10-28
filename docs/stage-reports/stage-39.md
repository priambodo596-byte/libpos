# Stage 39 — Preserve images within HTML table cells

## Scope

- Fixed structural HTML clipboard import so an allowed image inside a table cell is inserted into that cell's block content instead of becoming a top-level document block.
- Preserved text before and after an image as separate paragraph blocks within the same cell.
- Corrected block-tag handling within table cells so paragraphs in a cell no longer leak into the top-level clipboard document.
- Added a regression test for text + image + text in one table cell.

## Verification

- `pnpm --filter @convetlib/editor test -- clipboard.test.ts`: 21 tests passed.
- `pnpm --filter @convetlib/editor typecheck`: passed.
- `git diff --check`: passed.
- Full workspace `pnpm run verify`: passed (build, typecheck, tests across all six packages).
- Workspace test totals: core 112, editor 84, DOCX 31, PDF 21, templates 6, UI 4 — 258 tests passed.
- `git diff --check`: passed.

## Limitations

The parser remains a constrained allow-list parser, not a full HTML5/CSS layout engine. This change does not guarantee arbitrary nested table/list/image fidelity or pixel-identical browser/Word output.
