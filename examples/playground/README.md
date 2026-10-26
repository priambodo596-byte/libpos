# @convetlib/playground

A browser-run playground for the actual Convetlib document model and export adapters. This is an example app, not part of the published framework-agnostic core package.

## Run locally

From the repository root:

```bash
pnpm install
pnpm --filter @convetlib/playground dev
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`).

## Implemented against real packages

- `@convetlib/core`: creates the initial `DocumentJSON`, creates the editor engine, validates models with `coreSchema`, and replaces the editor document after valid JSON is submitted.
- `@convetlib/docx`: imports DOCX/DOTX packages and exports DOCX.
- `@convetlib/pdf`: exports PDF.
- The JSON panel, document preview, schema status, and field inventory are rendered from the active editor model.

## Current limitations

- This is a functional integration prototype, not yet a complete rich-text/WYSIWYG editing surface.
- Text placeholders in the sample document are ordinary text tokens. Placeholder nodes are supported by the model but automatic field-value binding is not implemented yet.
- DOCX/DOTX import and DOCX/PDF export should be checked against representative real-world templates before production use. PDF output uses the existing semantic renderer, not browser-pixel-identical HTML rendering.
