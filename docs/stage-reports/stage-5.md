# Stage 5 — Cross-section Text Selection and Clipboard

Status: **bounded top-level content scope implemented and verified**.

## Delivered

- Cross-section replacement for selections whose endpoints are top-level text blocks in the document body.
- Cross-section delete/cut preserves each section and its page setup; section boundaries are not joined.
- Copy/cut selection text and supported inline marks across sections in document order.
- Safe refusal for nested structures, tables/lists, and selections that cross header/body/footer slots.
- Tests cover direct command execution, command availability, copy/cut, and preservation of both section boundaries.

## Explicit scope

This increment does not provide a general cross-section structural merge. It deliberately rejects selections that cross nested containers or non-text blocks. It also does not make header/body/footer a single linear text flow. Rich clipboard image/table interchange remains separate work.

## Verification

`pnpm --filter @convetlib/editor test` and root `pnpm run verify` pass. Browser matrix passed on Chromium, Firefox, and WebKit, including the existing axe accessibility baseline, DOM selection mapping, typing, native clipboard, synthetic composition ordering, and cross-block structural deletion checks. These are automated checks; they do not replace real-OS IME testing or a human screen-reader audit.
