# Stage 26 — Functional Page Setup

## Delivered

- Replaced static A4/portrait toolbar chips with interactive paper size, orientation, and margin selectors.
- Supported page sizes: A4, Letter, Legal.
- Supported orientation: portrait and landscape.
- Supported margins: normal, narrow, and wide; page margin values are stored in the document's section page setup in twips.
- Page setup changes are applied to every section through validated document replacement, so DOCX/PDF adapters can consume the same document model settings.
- Preview paper width, height, and content padding update from the current section's page setup.
- Captured screenshot at `docs/stage-reports/convetlib-page-setup.png`.

## Verification

- Playground production build: passed.
- Local server: `http://127.0.0.1:5173/` returned HTTP 200 and the new controls were present in served HTML.
- Full workspace verification (`pnpm run verify`): passed; build and typecheck succeeded for all six packages and all 199 tests passed (core 98, editor 73, DOCX 12, PDF 9, templates 6, UI 1).

## Manual checks

1. Open `http://127.0.0.1:5173/`.
2. Switch PAPER from A4 to Letter and Legal; confirm paper width/height and JSON page size change.
3. Switch ORIENTATION between Portrait and Landscape; confirm preview dimensions and JSON orientation update.
4. Switch MARGIN between Normal, Narrow, and Wide; confirm preview padding and JSON margins update.
5. Export DOCX/PDF and inspect page size/orientation/margins in the generated files.

## Limitations

- Preview dimensions and padding reflect the model's first section; section-specific page breaks and multi-section layout are not yet visually paginated as a full word processor would.
- Export fidelity must still be verified in external DOCX/PDF readers.
