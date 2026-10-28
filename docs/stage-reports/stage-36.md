# Stage 36 — Header/footer variant editor integration

## Status
Implemented and verified for the current scope: first-page and even-page header/footer regions are accessible in core/editor operations and editable from the playground preview.

## Changes
- Extended `ParentRef.slot` additively with `firstPageHeader`, `firstPageFooter`, `evenPageHeader`, and `evenPageFooter`; existing `content`, `header`, and `footer` remain supported.
- Core engine block lookup, parent lookup, and `insert_block` routing support all seven section regions and create missing variant arrays when needed.
- Editor text-block lookup, sibling lookup, selected-block address routing, structural selection lookup, clipboard lookup, and toolbar block lookup scan variant regions.
- Playground preview now shows four labeled variant-region panels per non-canvas section. Each region supports adding an empty paragraph, editing text through the browser editor binding, and deleting a block. Field discovery and field deletion also include all four variant arrays.
- Empty paragraph preview emits a `<br>` caret target so a newly added variant paragraph can receive browser input and persist it to the model.
- Added regression tests for variant insert + undo/redo, text edits in a variant footer, creation of an undefined variant region, and rejection of selections spanning body and a variant region.

## Verification
- `pnpm --filter @convetlib/editor test`: passed, 81 tests.
- `pnpm run verify`: passed (build, typecheck, tests across six packages). Package test totals observed: core 112, editor 81, DOCX 31, PDF 21, templates 6, UI 4 = 255 tests.
- `pnpm --filter @convetlib/playground build`: passed (216 modules transformed). Vite still warns that the fontkit bundle exceeds 500 kB; this is a performance warning, not a build failure.
- `pnpm --filter @convetlib/editor test:browser:all`: Chromium, Firefox, and WebKit integration suites passed for the existing browser-editor matrix.
- Headless Chromium playground smoke test: confirmed all four variant panels render, add/edit/delete updates the JSON model, removing one variant block does not modify the other regions, and no page errors occurred.
- Screenshot evidence: `docs/stage-reports/stage-36-playground.png`.
- `git diff --check`: no whitespace errors after normalizing edited source-file EOFs; Git may still print Windows LF-to-CRLF informational warnings.

## Scope notes
- The playground panels are editing surfaces for the variant regions, not a pagination engine that visually selects a different header/footer for each simulated page. Page-by-page conditional rendering and full pagination fidelity remain separate layout work.
- DOCX import/export code already has first/even header/footer mapping; this stage's verification covers the existing DOCX test suite, not a new exhaustive round-trip fidelity matrix for all variant combinations.
- No claim is made that all long-term Convetlib enterprise gaps (PDF import, complete pagination, review workflow, realtime collaboration, or framework adapters) are finished.
