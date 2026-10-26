# Stage 6 — Structural clipboard fragments

## Implemented

- Clipboard payloads can now carry structural `BlockNode` fragments separately from text runs.
- Paste inserts image and table fragments as real document nodes, preserving the surrounding text by splitting the target paragraph at the selection.
- Structural nodes are cloned with fresh IDs; unsupported node types, malformed table nesting, excessive depth, and unsafe image URL schemes are rejected before dispatch.
- Image URLs are restricted to HTTP(S) and selected base64 image data URLs. Imported text marks are allow-listed.
- Added tests for image insertion, table row/cell structure, surrounding text preservation, and rejection of `javascript:` image sources.

## Verification

- `pnpm --filter @convetlib/editor test`: 62 tests passed.
- `pnpm --filter @convetlib/editor typecheck`: passed, including test typecheck.

## Scope / remaining work

- This increment exposes a structural-fragment path for clipboard adapters. The existing conservative HTML parser still primarily imports text and inline marks; automatic extraction of mixed HTML containing images/tables plus surrounding paragraphs is not yet complete.
- Image binaries are not fetched or embedded automatically. Clipboard adapters must provide supported image URLs or data URLs.
- Complex table spans, arbitrary CSS, SVG, embedded objects, and complete browser/OS clipboard interoperability are not claimed.
- Next: HTML-to-structural-node parsing with sanitizer tests, then layout/pagination, DOCX/PDF import/export, review workflows, and collaboration.
