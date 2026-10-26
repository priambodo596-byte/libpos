# Stage 15 - DOCX import fidelity improvements

## Implemented

- Embedded supported raster images (PNG, JPEG, GIF, BMP) are converted into editable `image` block nodes with data URI sources. Drawing dimensions are read from OOXML extents when present and bounded to avoid unreasonable values.
- Removed the previous image placeholder text for recognized embedded images. Image blocks are currently placed after the paragraph containing the drawing, because the core model represents images as block nodes and does not yet support inline image atoms.
- Reads `word/numbering.xml` and maps basic first-level numbering definitions to `orderedList` or `bulletList` nodes. Adjacent paragraphs with the same numbering ID and list type are grouped; ordered-list start values are preserved.
- Added tests for embedded image import and basic ordered-list grouping.
- Corrected DOCX page size/margin handling to preserve OOXML twips in the core model, consistent with `PageSetup` and DOCX export.
- Updated README scope and limitations.

## Verification

- DOCX package tests: 7 tests passed.
- Full workspace `pnpm run verify`: passed; build and typecheck passed and all **191 tests passed** (core 98, editor 70, templates 6, DOCX 7, PDF 9, UI 1).
- `git diff --check`: passed.

## Scope / remaining work

- Inline image position relative to surrounding text is approximated as a block after its paragraph; exact inline/floating positioning is not preserved.
- Numbering import currently maps first-level formats only. Nested levels, per-paragraph level overrides, numbering restarts, custom numbering glyphs, and numbering style inheritance are not yet implemented.
- Hyperlinks, inherited/custom styles, headers/footers, multiple section fidelity, comments/revisions, merged cells, floating objects, and pixel-perfect Word layout remain out of scope.
- Only supported raster image formats within configured limits are embedded. External relationships are skipped; remote fetching is never performed implicitly.
