# Stage 28 — Import DOCX/DOTX Workflow

## Goal

Allow users to open documents authored manually in Microsoft Word (`.docx`) and Word templates (`.dotx`) inside the Folio/Core playground, rather than recreating the document from JSON.

## Delivered

- Kept the existing Open `.docx/.dotx/.json` file picker and connected it to a centralized import workflow.
- Added drag-and-drop import onto the document preview canvas for DOCX, DOTX, and JSON files.
- Added a 25 MiB file size guard and basic OOXML ZIP signature validation before calling the DOCX importer.
- DOCX/DOTX are parsed through `@convetlib/docx` `importDocx`; the resulting model must pass core schema validation before replacing the active document.
- Added post-import diagnostics in the status bar: section count, paragraph count, table count, image count, and text-character count.
- Updates the document title field from imported metadata/filename.
- Added a visible drop-target treatment while a supported file is dragged over the preview canvas.
- Captured current playground UI screenshot at `docs/stage-reports/convetlib-docx-import.png`.

## Existing importer capabilities used

The DOCX adapter already parses OOXML into the model and has tests for paragraphs, headings, character marks, tables, page geometry, numbering/lists, images, hyperlinks, section headers/footers, inherited styles, and import input limits. Stage 28 exposes that capability through a more usable import flow; it does not claim perfect Word layout fidelity.

## Verification

- Playground Vite production build passed. A chunk-size advisory remains because the playground bundle exceeds 500 kB.
- `http://127.0.0.1:5173/` returned HTTP 200; import button and playground UI are present.
- Full `pnpm run verify` passed: all six packages built and typechecked; 199 tests passed (core 98, editor 73, DOCX 12, PDF 9, templates 6, UI 1).
- Screenshot captured from the actual local playground at `docs/stage-reports/convetlib-docx-import.png`.

## Manual checks

1. In Microsoft Word, save a document as `.docx`.
2. Open the playground and click `Open .docx/.dotx/.json`, then choose that file. Alternatively drag it onto the white document preview.
3. Confirm the title, text, tables, images, headers/footers, and page settings that are supported by the importer appear in the model/preview.
4. Check the status bar import summary.
5. Export the imported document to DOCX and PDF and compare both outputs with the original Word document.
6. Try a renamed/non-OOXML file and a file over 25 MiB; expect a clear import error.

## Limitations

- This is a semantic DOCX import, not a pixel-perfect reproduction of every Word layout feature. Floating shapes, SmartArt, text boxes, complex section-specific headers/footers, field codes, tracked changes, embedded OLE objects, and some advanced table/paragraph formatting may not round-trip exactly.
- The 25 MiB limit is an application guard; the adapter also enforces its own ZIP entry and XML part limits.
- Manual testing with a real user-provided Word document is still needed to validate the specific template and its layout.
