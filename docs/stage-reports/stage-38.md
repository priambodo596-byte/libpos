# Stage 38 — Nested HTML list stack correctness

## Scope

- Fixed structural HTML clipboard parsing so closing `</li>` exits the current list item and closing `</ul>`/`</ol>` exits the current list.
- Prevented following outer-list items or normal text from being attached to a previously closed nested list item.
- Added a regression fixture with two nested items followed by a sibling outer item.
- Updated blocked-element text assertions to reflect correct separation between list content and following top-level text.

## Verification

- `pnpm --filter @convetlib/editor test -- clipboard.test.ts`: 20 tests passed.
- `pnpm --filter @convetlib/editor typecheck`: passed.
- `git diff --check`: passed.
- `pnpm run verify`: passed (all six package builds and typechecks; 257 workspace tests passed: core 112, editor 83, DOCX 31, PDF 21, templates 6, UI 4).
- `git diff --check`: passed.

## Notes

This stage improves HTML structural import, but does not make the parser a full HTML5 parser. CSS layout, arbitrary malformed markup repair, nested image/table content in all combinations, and fidelity to Word/browser rendering remain separate work.
