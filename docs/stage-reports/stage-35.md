# Stage 35 — First-page and even-page headers/footers

## Problem

`importDocx` only read the *default* header/footer reference. First-page (`titlePg`) and even-page (`evenAndOddHeaders`) parts were silently dropped, and the model had no place to store them (`Section` carried a note that this was a later-stage extension).

## Change

- **Model (additive, no breaking change):** `Section` gains optional `firstPageHeader`, `firstPageFooter`, `evenPageHeader`, `evenPageFooter`. Defining either region of a variant enables it; the other defaults to blank; `[]` means a deliberately blank region. `header`/`footer` stay the default (odd-page) regions.
- **Schema:** all six regions are validated like `header`/`footer` (unknown nodes, duplicate ids).
- **Core helpers (new public exports):** `resolveSectionHeaderFooter`, `sectionUsesFirstPageVariant`, `sectionUsesEvenPageVariant`. First-page wins over even-page, which wins over default, matching Word.
- **DOCX export:** writes `first`/`even` header and footer parts, `w:titlePg`, and `w:evenAndOddHeaders` in settings (only when a variant exists).
- **DOCX import:** reads `titlePg` and `evenAndOddHeaders` (explicit `false`/`0`/`off` count as off) and the `first`/`even` references; an enabled variant without a part becomes `[]`. An unreadable `settings.xml` does not fail the import; the even-page variants are just not applied.
- **PDF export:** picks regions per page with the shared resolver (first page of each section, even document page numbers).

## Tests

Core: resolver precedence and blank-region rules, schema acceptance/rejection of variant regions. DOCX: full round trip of all four variants, `titlePg`/`evenAndOddHeaders` emitted only when needed, blank first-page header, malformed `settings.xml`. PDF: the right regions on pages 1-4.
The core API-surface guard test (`architecture.test.ts`) was updated for the three new exports.

## Verification

`pnpm run verify` passed: core 112, editor 78, DOCX 31, PDF 21, templates 6, UI 4. `git diff --check` clean. Browser integration tests were not run.

## Limitations (still open)

- **Editor:** commands, selection and slot addressing (`slot: "header" | "footer"`) do not know the variant regions, so they cannot be edited through the editor yet. Block lookup by id only scans `header`/`footer`.
- **Preview:** the playground renders only the default header/footer.
- **Multi-section DOCX:** import still produces one section; the variants are read from the first `sectPr` found. Per-section variants in multi-section Word files are not imported.
- PDF "even" follows the document page number; Word's page-number restarts per section are not modelled.
- Not verified in Microsoft Word.
