# Stage 37 — Page-specific header/footer pagination metadata

## Scope

- Extended editor pagination output with selected header/footer block placements and aggregate heights per page.
- Reuses the core `resolveSectionHeaderFooter` rules: first-page variant takes precedence on a section's first page, even-page variants apply on even document page numbers, and default regions apply otherwise.
- Header/footer blocks use the same host-provided measurement callback and content width as body blocks, with invalid heights rejected consistently.
- Kept body pagination semantics unchanged; header/footer measurements do not consume the body content area's height because they occupy the page margins.

## Verification

- `pnpm --filter @convetlib/editor test -- pagination.test.ts`: 8 tests passed.
- `pnpm --filter @convetlib/editor typecheck`: passed.
- `pnpm run verify`: passed (all six package builds and typechecks; 256 workspace tests passed: core 112, editor 82, DOCX 31, PDF 21, templates 6, UI 4).
- `git diff --check`: passed.

## Explicit limitations

This is layout metadata, not a complete page renderer. It does not paint header/footer blocks, split paragraphs or oversized tables/images across pages, or guarantee identical layout between browser, DOCX, and PDF renderers. Those remain separate unfinished work.
