# TODO: Playground UI/UX — draf prioritas

Draf todo list untuk area UI/UX playground (`examples/playground`) yang belum memiliki implementasi logika penuh atau masih terbatas.

## Sudah terimplementasi (konteks)

- JSON panel: format / copy / download / edit + auto-repair (`normalizeImportedStructure`) + replace ke core editor.
- Import JSON (native Convetlib + external AI block JSON) → perbaikan otomatis (revision, unknown node, flat text, list, table, callout, signature) → validasi → render.
- Import DOCX/DOTX → canvas aktif; export DOCX/PDF.
- Canvas ops: tambah/hapus/move/copy/paste canvas, merge import ke canvas aktif.
- Drag & drop gambar, image tools, delete image.
- Formatting editor: bold / italic / underline / align / text color.
- Field placeholder: add / edit / delete / drag.
- Keyboard shortcut inti (Ctrl+B/I/U/S, Ctrl+Shift+?, Esc, Ctrl+/).
- Preview views: PREVIEW / HTML / PLAIN TEXT / SERIALIZED.
- Print: `@page` diperbaiki ke `size:210mm 297mm` (A4 portrait) / `297mm 210mm` (A4 landscape); chrome editor dinihilkan via `@media print`; placeholder dicetak sebagai teks biasa; canvas sheet = 1 halaman per sheet (`break-after: page`).

## Todo aktif

### P1 — Rich-text / WYSIWYG editing surface

- [x] Draft ditulis: `docs/ui-todo.md`.
- [x] Implementasi tahap pertama (selesai): click-to-edit teks blok (`paragraph` / `heading` / `codeBlock`) di PREVIEW via textarea inline; commit → `editor.replaceDocument` + `render`; Escape / Enter / blur; blok dengan placeholder field ditolak edit.
- [x] Verifikasi live di browser (dev server) untuk alur edit → JSON → export (todo sisa).
- Catatan implementasi: `startTextEdit` di `examples/playground/src/main.js`; textarea memakai inline style + `outline:1px solid #3978ef` saat fokus; `Escape`/`Enter`/blur commit lewat `replaceDocument`; gagal commit menampilkan `result.issues` (bukan `error`) lewat status.

### P1 — Field value binding

- [ ] Draft: placeholder node didukung model, tapi automatic field-value binding belum ada.
- [x] Implementasi tahap pertama (selesai): core `@convetlib/docx` + `@convetlib/pdf` menambahkan `fieldValues` ke export options; placeholder `{{key}}` memakai nilai field (fallback) saat di-set.
- [x] Playground: panel FIELDS menyimpan nilai per key (`fieldValues` map) via input; nilai di-feed ke export DOCX/PDF.
- [x] Nilai field ikut tersimpan pada autosave sesi browser dan dipulihkan saat playground dibuka kembali.
- Todo lanjutan: belum ada. Nilai field disimpan di state UI sesi; JSON dokumen yang diekspor tetap hanya berisi model dokumen.

### P2 — Block move lintas region

- [x] Drag & drop blok antar header, content, footer, first-page header/footer, even-page header/footer, dan content canvas manual, termasuk lintas section.
- Drop ke region header/footer kosong dan area kosong canvas didukung. Paragraph/gambar yang dipindahkan ke canvas mendapat posisi sesuai lokasi drop; saat dipindahkan keluar canvas, atribut posisi dibersihkan agar kembali ke alur dokumen.
- Node lain tetap dapat dipindahkan ke canvas sebagai konten alur. Semua perpindahan melewati validasi model dan ditolak jika strukturnya tidak valid.

### P2 — DOCX re-import anchored image

- [ ] Draft: re-import DOCX yang sudah di-export belum restore posisi image ter-anchor (`wp:anchor` → flow image).
- Catatan: README menyatakan hal ini.

### P3 — PDF export

- [ ] Draft: PDF export pakai semantic renderer, belum pixel-identical dengan HTML rendering.

### P3 — Cleanup teknis

- [ ] Hapus file sisa `examples/playground/src/pages-canvas.js.tmp` (duplicate tidak termuat) agar tidak menyesatkan.
- [ ] Audit akhir: session save/restore (`session-store.js`, `?storage=local|web`), auto-save, draft.

## Catatan audit UI saat ini

- Semua kontrol utama di `index.html` sudah punya handler dasar di `main.js` / `pages-canvas.js`.
- Bagian yang perlu dicek lebih lanjut: panel detail (`statsDetails`, `schemaDetails`, `dataDetails`, `pluginDetails`, `fieldhelp`, `pageSummary`, `jsonFollow*`, `leftPages`, `leftJson`).
- Pola perbaikan error import saat ini ada di `normalizeImportedStructure`; todo lanjutan: pertahankan pola ini saat feature UI baru menambah format blok.
