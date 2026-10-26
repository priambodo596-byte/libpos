# Stage 25 — Functional Inspector Panels

## Delivered

- Replaced the decorative DATA / SCHEMA / STATS / PLUGIN labels with accessible, interactive inspector tabs.
- FIELDS remains the default panel and retains field discovery/custom placeholder flow.
- DATA panel displays document metadata and supports updating `meta.title` through schema-validated document replacement.
- SCHEMA panel lists registered core node and mark names from `coreSchema`.
- STATS panel derives node counts, paragraphs, headings, tables, rows, cells, images, placeholders, serialized JSON size, and schema issue count from the current model.
- PLUGIN panel reports the core/editor/DOCX/PDF adapters wired into this playground and explicitly states that a runtime plugin registry/installer is not implemented.
- Added responsive styling for tabs, metrics, schema tokens, and metadata controls.
- Captured actual playground UI screenshot at `docs/stage-reports/convetlib-inspector-panels.png`.

## Verification

- Playground Vite production build passed.
- Local playground responded with HTTP 200 at `http://127.0.0.1:5173/`.
- Full workspace verification (`pnpm run verify`) passed: build and typecheck succeeded for all six packages; all 199 tests passed (core 98, editor 73, DOCX 12, PDF 9, templates 6, UI 1).
- Local playground responded with HTTP 200 at `http://127.0.0.1:5173/` after changes.
- `git diff --check` reported no whitespace errors (line-ending normalization notices may appear on Windows).

## Manual checks

1. Open `http://127.0.0.1:5173/`.
2. Click DATA and edit the document title, then select Apply title. Confirm the JSON model and preview refresh.
3. Click SCHEMA and confirm node/mark names appear.
4. Click STATS and confirm counts reflect the current document.
5. Click PLUGIN and confirm adapter status and limitations are shown.
6. Return to FIELDS and verify the field list remains available.

## Limitations

- PLUGIN is an informational adapter status panel, not a plugin registry or installer.
- FIELDS is not yet a full CRUD field manager.
- Page size/orientation controls, image rendering, and full import/export fidelity are separate follow-up work.
