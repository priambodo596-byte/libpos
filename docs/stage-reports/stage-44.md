# Stage 44 — PDF pagination guard for headings

## Changes
- Before drawing a heading, estimate the heading and following text block's line heights. If they will not fit together in the remaining content area, move the heading to the next page.
- This reduces orphaned headings at the bottom of PDF pages while retaining normal line-by-line pagination for paragraphs and repeated header/footer rendering.
- Added a regression test asserting that a heading and its following paragraph are rendered on the same PDF page when the remaining space is insufficient.

## Verification
- PDF package typecheck passed.
- PDF tests passed: 22 tests across 2 files.
- Browser verification from Stage 43 passed for a placeholder split across adjacent differently formatted text nodes; screenshot is saved at `B:\convetlib\stage43-placeholder-verified.png`.
- Full monorepo verification is run before this stage is committed.

## Remaining limitations
- The PDF renderer is semantic, not pixel-identical to Word or browser print.
- Custom embedded font bytes are needed for exact Times New Roman and broader Unicode coverage.
- Very tall single table rows, complex floating image overlaps, and cross-format visual fidelity still need dedicated fixture-based visual regression testing.
