# Stage 29 — DOCX Import Validation and Paragraph Fidelity

## Defect addressed

Imported Word headers and body paragraphs could include `lineSpacing`, `lineSpacingRule`, `styleId`, `styleName`, `styleBasedOn`, indentation, and spacing attributes, but the core paragraph/heading schema rejected them as unknown attributes. This caused imports to fail validation even though the DOCX adapter had extracted legitimate Word paragraph properties.

## Delivered

- Extended core paragraph and heading schema with validated optional attributes for spacing before/after, line spacing and rule, left/right/first-line/hanging indentation, and paragraph style metadata.
- Allowed Word line spacing rules `auto`, `exact`, and `atLeast`.
- Added a regression assertion that imported custom paragraph style/spacing data passes `Schema.create().validate(imported)` with zero issues.
- Updated playground preview rendering to apply imported paragraph alignment, spacing, indentation, and line-spacing attributes as CSS.
- Existing preview rendering includes section header and footer nodes; this stage preserves their model data and makes paragraph formatting visible where supported.
- Captured the actual playground UI screenshot at `docs/stage-reports/convetlib-stage29-fidelity.png`.

## Verification

- `pnpm run verify`: passed; all six packages built and typechecked, all 199 tests passed (core 98, editor 73, DOCX 12, PDF 9, templates 6, UI 1).
- Playground production build: passed. Vite reports an existing large-chunk advisory (~1.84 MB minified); build exits successfully.
- Local playground returned HTTP 200.
- Regression test specifically checks that imported custom style attributes pass core schema validation.

## Manual validation

1. Import the same `.docx` that previously reported unknown `lineSpacing`, `lineSpacingRule`, `styleId`, `styleName`, and `styleBasedOn` attrs.
2. Confirm the invalid document model error no longer appears and the schema status is valid.
3. Inspect header/footer and paragraph alignment, spacing, and indentation.
4. Export DOCX/PDF and compare with Microsoft Word.

## Fidelity limitations

- This stage addresses schema compatibility and common paragraph spacing/indentation in the HTML preview; it does not deliver full Word layout parity.
- Floating shapes, text boxes, SmartArt, complex section-specific header/footer inheritance, exact line metrics, advanced table layout, and all font/style behavior still require additional adapter work and representative source documents.
- Imported image nodes are still represented as image placeholders in the current playground preview renderer; actual image embedding/display needs a separate fidelity improvement.
