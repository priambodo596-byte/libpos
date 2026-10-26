# Stage 22 — HTML table span interoperability

## Delivered

- HTML clipboard import now reads `colspan` and `rowspan` for `td` and `th` elements.
- Span values must be integers from 1 through 100; invalid, fractional, zero, negative, or excessive values fall back to 1.
- Added a regression test covering valid merged cells and invalid/out-of-range span values.
- Added a type-safe check for row content before collecting table cells in the test.

## Verification

- `pnpm run verify` completed successfully.
- Workspace build succeeded for all six packages.
- Workspace typecheck succeeded for all six packages.
- All workspace tests passed: core 98, editor 71, DOCX 12, PDF 9, templates 6, UI 1 (197 total).
- `git diff --check` completed without whitespace errors; Git reports only line-ending normalization notices on the edited TypeScript files.

## UI/UX evidence

The existing browser UI screenshot is retained at `docs/stage-reports/convetlib-editor-ui-preview.png`. It documents the actual Folio/Core playground UI and is not a test-result screenshot.

## Scope and limitations

This stage improves HTML table structure import into the clipboard document model. It does not claim complete HTML-to-DOCX fidelity or preservation of every CSS layout/style feature.