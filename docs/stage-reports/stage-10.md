# Stage 10 — PDF image embedding through host resolver

## Implemented

- `@convetlib/pdf` accepts an optional `resolveImage(source)` callback that returns binary PNG or JPEG bytes.
- Resolved images are embedded into the PDF, scaled to fit the page content width and height, and placed as block content.
- Remote resources are never fetched automatically; applications control authentication, URL policy, caching, and binary retrieval.
- If no resolver is supplied or resolution/embedding fails, the renderer falls back to the image alt-text placeholder rather than failing the whole document export.
- Added a test that embeds PNG bytes and reloads the resulting PDF.

## Verification

- `pnpm --filter @convetlib/pdf test`: 4 tests passed.
- `pnpm --filter @convetlib/pdf typecheck`: passed.
- `pnpm --filter @convetlib/pdf build`: passed.
- Full workspace `pnpm run verify`: passed; **182 tests passed** across core, editor, UI, templates, DOCX, and PDF.

## Scope / remaining work

- Image support is currently for PNG and JPEG only, with image blocks rendered at their requested or intrinsic dimensions, scaled to the page content area.
- No implicit HTTP fetch, SVG/GIF conversion, inline text wrapping, captions, or advanced cropping is provided.
- Standard Helvetica remains the default; custom font embedding, inline marks, headers/footers, page numbering, PDF accessibility tags, and advanced table layout remain future work.

