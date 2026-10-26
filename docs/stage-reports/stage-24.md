# Stage 24 — Safe HTML link interoperability

## Delivered

- Structural HTML clipboard import now recognizes anchor elements.
- Safe `http:`, `https:`, `mailto:`, and `tel:` href values are preserved as link marks, including an optional title.
- Scheme-relative URLs and unsafe schemes such as `javascript:` are not retained in link marks.
- Added regression coverage for safe URL/title preservation, nested bold marks, and rejecting unsafe destinations.
- Corrected URL control-character validation to use the intended Unicode range.

## Verification

- Editor tests: 73 passed.
- Workspace build: passed for all six packages.
- Workspace typecheck: passed for all six packages.
- Workspace tests: passed (199 total: core 98, editor 73, DOCX 12, PDF 9, templates 6, UI 1).
- Playground dev server responds with HTTP 200 at `http://127.0.0.1:5173/`.

## Manual testing

Start the playground with `pnpm --filter @convetlib/playground dev` from the repository root, then open `http://127.0.0.1:5173/` on the same computer. This is a local development URL, not a public internet deployment.

## Limitations

This stage preserves safe link metadata in imported HTML fragments. UI rendering/click behavior for link marks and full HTML/CSS round-trip fidelity remain separate follow-up work.