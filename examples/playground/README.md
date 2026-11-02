# @convetlib/playground

A browser playground for the Convetlib document model, editor, and export adapters. It is an example application, separate from the published framework-agnostic core package.

## Run locally

From the repository root:

```bash
pnpm install
pnpm --filter @convetlib/playground dev
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`).

## Official company-letter templates

Choose **Template Resmi** to create a letter template with the company's logo, letterhead, contact details, page size, margins, font, line spacing, and required number/date formats. Fill the required fields and use **Pemeriksa Template** before printing or exporting. A custom TTF/OTF file can be supplied so PDF typography matches the selected font.

The template profile and field values are applied to the preview and DOCX export. The **PDF (via Print)** action opens the browser's print dialog using the same HTML/CSS layout as **Print**; choose **Save as PDF** in that dialog. This makes the playground's PDF output match its print output.

The `@convetlib/pdf` package remains available to host applications as a semantic, text-first PDF renderer. It is not pixel-identical to the browser renderer; use the playground's **PDF (via Print)** action when browser layout parity is required.

## Implemented against real packages

- `@convetlib/core`: creates and validates `DocumentJSON` models and runs the editor engine.
- `@convetlib/editor`: browser editing commands, selection, and formatting integration.
- `@convetlib/templates`: official-letter template creation, field checks, and export options.
- `@convetlib/docx`: DOCX/DOTX import and DOCX export.
- `@convetlib/pdf`: semantic PDF export for host integrations.

## Known limitations

- Exact company compliance depends on entering the approved page, font, margin, numbering, and date rules in the template. The generic defaults are not a substitute for the company's controlled standard.
- DOCX pagination and layout can still vary with Word version, installed fonts, and printer settings. Validate representative documents in the target Word environment.
- Re-importing a DOCX does not preserve all floating-image positioning or advanced Word layout features.

## Free image positioning

Images can be dragged anywhere on a page in Preview. Position is stored as `attrs.positionX` / `attrs.positionY`, in CSS pixels from the top-left edge of the page. DOCX writes page-anchored floating images; the semantic PDF adapter converts coordinates from CSS pixels to PDF points. Re-importing a DOCX does not restore every anchored-image position.

## Save projects

**Simpan Proyek** (or `Ctrl+S`; `Ctrl+Shift+S` = Save As) stores the full design as a `<title>.convetlib.json` file. Open it again through **Open .docx/.dotx/.json**.

- On `localhost`, `127.0.0.1`, or `file:`, Chrome/Edge can save through the File System Access API. Browsers without that API download the file.
- On other hosts, the project remains in the downloaded file; it is not uploaded to a server.
- `?storage=local` and `?storage=web` force the storage mode for development checks.
