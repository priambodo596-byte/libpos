# Stage 17 - DOCX custom paragraph styles and spacing

## Implemented

- Reads `word/styles.xml` for paragraph styles, style names, `basedOn` inheritance, and outline levels.
- Resolves inherited paragraph properties with cycle protection and a 32-style depth cap. Direct paragraph properties override inherited values.
- Imports paragraph alignment, left/right indentation, first-line/hanging indentation, spacing before/after, line spacing, and line-spacing rule as model attributes.
- Retains the paragraph style ID/name/base-style metadata for downstream renderers and adapters.
- Adds a synthetic OOXML fixture test for custom style inheritance and direct-format overrides.
- Updates README scope and remaining limitations.

## Verification

- DOCX package typecheck passed.
- DOCX package tests: 9 tests passed.
- Full workspace `pnpm run verify`: passed; all packages built and typechecked, and all **193 tests passed** (core 98, editor 70, templates 6, DOCX 9, PDF 9, UI 1).
- `git diff --check`: passed.

## Scope / remaining work

- Character-style inheritance, run-level style resolution, theme fonts/colors, numbering style inheritance, and exact Word rendering are not implemented.
- Paragraph measurements are retained as OOXML twips/line values; renderers must interpret these attributes consistently.
