# Stage 42 — Automatic placeholder detection on open

## Changes
- The playground now scans opened `.docx`, `.dotx`, and Convetlib `.json` documents for placeholder text matching `{{field.key}}`.
- Matching text is converted to native placeholder inline nodes while preserving text before/after the token and the original text marks on those surrounding fragments.
- Detection traverses body content, nested structures such as tables, headers, footers, and first/even-page header/footer regions.
- The existing FIELDS panel automatically lists detected keys; status feedback reports how many placeholders were found and converted.
- Placeholder key matching follows the existing field-key convention: a leading letter, then letters/numbers/underscore/hyphen, with dot-separated segments.

## Verification
- `pnpm run verify` passed: build, typecheck, and all 258 package tests.
- `git diff --check` passed.

## Scope note
- This update targets the playground's Open-document flow. Tokens split across separate DOCX text runs (for example, if Word stores different characters of one placeholder with different run formatting) are not yet normalized as a single token; that edge case remains for a follow-up.
