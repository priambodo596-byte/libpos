# Stage 43 — Placeholder normalization across DOCX text runs and export consistency

## Changes
- Placeholder normalization now scans adjacent text nodes as one logical text sequence, so tokens split across DOCX runs (including runs with different marks) can be recognized, e.g. `{{SPK_` + bold `NOMOR` + `}}`.
- Text outside each matched token is retained with its original run marks; the placeholder itself becomes a native placeholder atom.
- PDF bold, italic, and bold-italic fallback fonts now use the Times family, matching the default regular Times-family selection more consistently, including when hosts provide only regular custom font bytes.
- Updated the PDF renderer documentation to describe its actual default font family and its semantic (not pixel-identical HTML/CSS) rendering contract.

## Browser verification
- Ran the playground in headless Microsoft Edge via Playwright.
- Opened a JSON document whose `{{SPK_NOMOR}}` token was split across three adjacent text nodes, with the middle run bold.
- Confirmed the FIELDS panel contained `SPK_NOMOR`, the status reported one placeholder detected and converted, one native placeholder token appeared in the preview, and there were no page errors.
- Screenshot evidence saved locally as `B:\convetlib\stage43-placeholder-verified.png`.

## Automated verification
- `pnpm run verify` is run for the full monorepo before commit.
- Note: PDF rendering is semantic and text-first; it is not pixel-perfect Word/HTML parity. Exact Times New Roman and broad Unicode support require supplying compatible font bytes. Exceptionally tall individual table rows/cells and complex floating images remain cases requiring additional layout-specific work and visual regression coverage.
