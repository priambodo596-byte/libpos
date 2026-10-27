# Stage 31 — Structural HTML Clipboard Parser Hardening

## Bugs fixed (`packages/editor/src/html-clipboard.ts`)

1. Entity decoding was sequential, so `&amp;lt;` became `<` instead of the literal text `&lt;`. Decoding is now single-pass and also handles numeric entities (`&#65;`, `&#x42;`); unknown or invalid entities are kept as-is.
2. The tokenizer split tags at the first `>`, even inside a quoted attribute value, which leaked markup into text and dropped the link. Quoted values are now respected.
3. `attr()` could read `href=` from text inside another attribute (e.g. `title`). Attributes are now parsed properly.
4. Nested blocked elements (`<svg><svg></svg>text</svg>`) leaked their content; blocked depth is now tracked. Self-closing blocked tags no longer swallow following content.

## Tests added (`packages/editor/test/clipboard.test.ts`)

Entity single-pass decoding, `>` inside attributes, real-vs-embedded `href`, nested blocked elements, unsafe link schemes.

## Verification

`pnpm run verify` passed: core 107, editor 78, DOCX 20, PDF 14, templates 6, UI 1. `git diff --check` clean.
Browser integration tests (`packages/editor/test/browser.integration.mjs`) were NOT run in this stage.

## Limitations

The parser is still a regex/tokenizer allow-list, not a full HTML5 parser. Malformed markup is handled best-effort. Other audit areas (DOCX fidelity, PDF, review/collaboration, React/Web Components adapters, accessibility) are untouched here.
