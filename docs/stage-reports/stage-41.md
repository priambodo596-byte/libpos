# Stage 41 — Align default PDF typography with DOCX

## Scope
Improve the PDF export's default font family for business-document output.

## Changes
- Default PDF body and headings now use the built-in Times font family (Times Roman, Bold, Italic, Bold Italic), aligning more closely with the DOCX default Times New Roman family.
- Custom embedded font support remains available for hosts that require exact Times New Roman glyphs and broader Unicode coverage.
- No browser printing or full layout-parity claims are made by this stage.

## Verification
- PDF package tests and typecheck run after the change.
- Full workspace verification run before commit.
- `git diff --check` run before commit.

## Known limitations
Built-in PDF Times fonts are metrically similar but not identical to Times New Roman. Exact font parity requires host-supplied font bytes. Unicode text outside the standard font encoding may still need an embedded font.
