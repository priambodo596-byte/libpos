# Stage 19 — DOCX numbering, nested lists, and overrides

## Delivered

- Parses up to nine levels (`w:ilvl` 0–8) from `word/numbering.xml`, retaining each level's bullet-versus-ordered type and start value.
- Supports `w:lvlOverride` definitions and level-specific format/start overrides, plus `w:startOverride` for the top-level list start.
- Converts adjacent paragraphs sharing a numbering instance into nested `orderedList`/`bulletList` and `listItem` nodes while preserving sibling order.
- Adds an automated DOCX fixture that verifies a list starting at 5, a nested bullet item, and the following top-level sibling.

## Verification

- `pnpm run verify`: passed (build, typecheck, and all 195 workspace tests).
- DOCX package tests: 11 passing; core 98, editor 70, templates 6, PDF 9, UI 1.
- Screenshot proof: `stage-19-numbering-proof.png`, generated from the tested fixture's expected imported structure; it is a visual evidence page, not a Microsoft Word screenshot.

## Scope and limitations

- The model can represent nested lists, but this importer currently maps numbering to ordered versus bullet lists only; decimal/letter/Roman formats and bullet glyph/font details are not preserved.
- Advanced numbering restarts, complex counter relationships, and every OOXML override interaction are not fully implemented.
- List paragraphs with different numbering instance IDs start a separate list; image nodes discovered in list paragraphs are still emitted after the grouped list rather than inline in each list item.
