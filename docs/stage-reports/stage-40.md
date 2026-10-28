# Stage 40 — DOCX enterprise default typography

## Scope
Improve the default Word export baseline for business documents without changing the framework-agnostic document model or adding a website.

## Changes
- DOCX output now declares Convetlib as creator and a generated-business-document subject.
- Default document typography is Times New Roman, 12 pt, black.
- Default paragraph spacing is 6 pt after with automatic 1.15 line spacing.
- Heading levels 1–3 receive a consistent Times New Roman hierarchy and keep-with-next spacing.

## Verification
- `pnpm run verify`: passed (build, typecheck, tests across all six packages).
- DOCX tests: 31 passed.
- PDF tests: 21 passed.
- `git diff --check`: run before commit.

## Limitations
This is a formatting baseline, not a guarantee of universal corporate compliance. Organizations may require specific letterhead, margins, numbering, signature blocks, font rules, and document-specific templates. PDF remains a semantic renderer and does not yet promise pixel parity with Word or browser print layout.
