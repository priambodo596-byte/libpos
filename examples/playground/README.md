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

## Free image positioning

Images can be dragged anywhere on the page in the Preview view (pointer events; `Esc` cancels a drag). On release the position is written once to the model as `attrs.positionX` / `attrs.positionY` on the `image` node.

- **Coordinate system:** CSS px (96 dpi) from the top-left corner of the page edge (not the content area, margins are not subtracted). Values are clamped to `0 … pageSize − imageSize` while dragging. Zoom is compensated (`paper.style.zoom`).
- **Region:** the image stays in the region it belongs to (`header`, `content` or `footer`); it is only drawn at an absolute page position. Moving a block between regions is not implemented.
- **Legacy images** (no coordinates) keep the previous flow layout. Clicking Kiri / Tengah / Kanan sets `align` and clears the free position.
- **Export:** DOCX writes a page-anchored floating image (`wp:anchor`, EMU offsets); PDF draws at `px × 0.75` pt with the Y axis flipped. Re-importing an exported DOCX does not yet restore anchored positions (anchored drawings are imported as flow images).

## Menyimpan proyek

Tombol **Simpan Proyek** (atau `Ctrl+S`; `Ctrl+Shift+S` = simpan sebagai) menyimpan seluruh desain (halaman alur, canvas, gambar, posisi) sebagai satu berkas JSON dokumen biasa, `<judul>.convetlib.json`. Berkas yang sama dibuka lagi lewat **Open .docx/.dotx/.json**.

- **Lokal** (`localhost`, `127.0.0.1` atau `file:`): berkas ditulis ke komputer Anda lewat File System Access API (Chrome/Edge). Anda memilih lokasi sekali; `Ctrl+S` berikutnya menimpa berkas yang sama. Peramban tanpa API ini mengunduh berkas ke folder Unduhan.
- **Website** (host lain): dialog arahan menjelaskan bahwa proyek tidak disimpan di server, ke mana berkas pergi (jendela Simpan sebagai atau folder Unduhan), cara memilih folder, saran cadangan, dan cara membukanya kembali. Dialog bisa disembunyikan dengan "Jangan tampilkan lagi".
- Paksa mode untuk pengujian dengan `?storage=local` atau `?storage=web` pada URL.
