# Stage 18 — Character Styles and Rich Text Fidelity

## Delivered

- Importer now reads Word character styles (`w:type="character"`) from `word/styles.xml`, including `basedOn` inheritance.
- Paragraph styles can contribute run-level formatting through their `w:rPr` properties.
- Run marks are resolved from inherited paragraph-style run properties, inherited character styles, then direct run properties; direct explicit off values can remove inherited bold, italic, underline, or strike formatting.
- Preserves supported bold, italic, underline, strike/double-strike, superscript, and subscript marks in imported text.
- Style inheritance is cycle-safe and capped at 32 links, matching the existing paragraph-style resolution guard.
- Added synthetic DOCX fixture verifying inherited underline, style-level formatting, and direct-run precedence.

## Verification

- `pnpm run verify`: passed (build, typecheck, and all 194 workspace tests).
- DOCX package tests: 10 passing; core 98, editor 70, templates 6, PDF 9, UI 1.

## Scope and limitations

This remains a semantic import, not pixel-perfect Word rendering. Character formatting outside the supported marks (fonts, font size, color, highlight, language, and theme resolution) is not mapped to the document model. OOXML toggle-property semantics can vary by style context; this implementation uses deterministic property precedence for the supported mark set. Inline images, complex numbering, tracked changes, fields, and advanced layout remain limited.
