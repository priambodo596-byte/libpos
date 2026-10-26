# convetlib â€” Enterprise Document Editor Library/SDK

**Status:** alpha / internal development
**Repository:** https://github.com/priambodo596-byte/libpos
**Workspace:** `B:\\convetlib` (Windows)

convetlib adalah library/SDK editor dokumen berbasis TypeScript yang dirancang agar dapat ditanamkan ke aplikasi lain. Repository ini berisi **library dan package source**, bukan aplikasi SaaS siap pakai: tidak menyediakan website, dashboard, sistem login, billing, atau backend wajib.

> **Penting:** package saat ini berstatus `0.1.0-alpha.0` dan menggunakan lisensi `UNLICENSED`. Gunakan untuk pengembangan/internal sampai nama package, lisensi, API, dan kebijakan distribusi disetujui. Jangan publish ke registry publik sebelum lisensi dan kesiapan rilis ditetapkan.

## Daftar isi

- [Fitur yang tersedia](#fitur-yang-tersedia)
- [Prasyarat](#prasyarat)
- [Instalasi dari source](#instalasi-dari-source)
- [Perintah pengembangan](#perintah-pengembangan)
- [Struktur repository](#struktur-repository)
- [Konfigurasi dan penggunaan dasar](#konfigurasi-dan-penggunaan-dasar)
- [Integrasi browser](#integrasi-browser)
- [Arsitektur package](#arsitektur-package)
- [Batasan saat ini](#batasan-saat-ini)
- [Troubleshooting](#troubleshooting)
- [Lisensi dan distribusi](#lisensi-dan-distribusi)

## Fitur yang tersedia

### `@convetlib/core`

- Model dokumen JSON berversi, schema validation, serta parsing/migrasi dokumen.
- Document factory untuk membuat dokumen, paragraph, heading, list, tabel, gambar, placeholder, dan page break.
- Engine editor framework-agnostic dengan immutable state snapshot.
- Transaction/operation sebagai jalur perubahan dokumen, validasi atomik, command registry, dan typed events.
- Plugin lifecycle dan kontrak adapter untuk storage serta collaboration.
- Undo/redo lokal berbasis snapshot untuk transaksi lokal yang didukung.

### `@convetlib/editor`

- Perintah insert/replacement teks, delete, split paragraph, paragraph/heading conversion, alignment, dan bold/italic/underline/strike.
- Pengeditan lintas blok yang didukung planner, termasuk sejumlah struktur bersarang.
- Penggantian seleksi lintas section untuk blok teks tingkat atas pada body dokumen; header/footer dan struktur bersarang lintas section ditolak secara aman.
- Perintah penghapusan baris/kolom tabel dengan guard untuk struktur yang tidak aman.
- Keyboard shortcut helper, clipboard plain/rich/structural utilities, HTML importer konservatif untuk teks dan urutan paragraf-gambar-tabel sederhana, fondasi pagination berbasis pengukuran host dengan dukungan `keepWithNext`, serta composition/IME utilities.
- Browser DOM binder untuk menghubungkan event input dan selection ke model.

### `@convetlib/ui`

- Model toolbar framework-neutral melalui `DEFAULT_TOOLBAR` dan `getToolbarState`.
- Tidak mengharuskan React atau framework UI tertentu.

### `@convetlib/docx`

- Semantic DOCX export through `exportDocx(document, options?)` and initial DOCX import through `importDocx(bytes, options?)`.
- Import reads common OOXML paragraphs, built-in Heading 1–6 and custom paragraph styles with bounded `basedOn` inheritance, paragraph alignment/indentation/spacing/line-spacing attributes, bold/italic/underline/strike/superscript/subscript marks, basic tables, and section page geometry.
- Embedded supported raster images (PNG, JPEG, GIF, BMP) are imported as editable block-level image nodes with data URIs and dimensions when available. Their position is approximated at paragraph level; exact inline positioning is not preserved.
- Word numbering definitions map to structured ordered/bullet lists, including nested levels (up to 9 levels), per-list start overrides, and level overrides. Advanced restart/override semantics and numbering formats beyond bullet-versus-ordered are not fully preserved. See the Stage 19 visual proof in `docs/stage-reports/stage-19-numbering-proof.png`.
- Safe hyperlinks (`http`, `https`, `mailto`, and internal anchors) are imported as `link` marks; unsupported or unsafe schemes are not retained.
- Default section headers and footers are imported as section-level block content. Header/footer variants, their own image relationships, and different-first/even-page behavior are not yet preserved.
- Optional host-provided image resolver for export; remote images are not fetched implicitly.
- DOCX import is a semantic foundation, not full-fidelity conversion. Paragraph style inheritance, common paragraph spacing/indentation, and supported rich-text marks inherited from paragraph/character styles and direct run properties are imported. Theme fonts/colors, comments/revisions, merged cells, advanced numbering restarts, floating objects, and pixel-perfect Word layout are not fully supported.

### `@convetlib/pdf`

- Semantic text-first PDF export through `exportPdf(document, options?)`.
- Supports page geometry, paragraphs, headings, explicit page breaks, automatic overflow pagination, and table cells with wrapped text. Tables accept relative `columnWidths` weights on the table node (for example `[3, 1]`) and repeat their first row as a header when continuing to a new page.
- Supports optional embedded/subsetted TrueType/OpenType fonts via `fontBytes` and optional bold/italic font variants. Marked text supports bold, italic, underline, and strike. Standard Helvetica remains the fallback; PNG/JPEG image embedding and repeating headers/footers/page numbering are also supported.

### `@convetlib/templates`

- Scalar placeholders with nested paths such as `{{ surat.nomor }}`.
- Lists placeholder keys and reports missing values, with optional strict mode.
- Optional escaping callback; template expressions are never evaluated.

Example:

```ts
import { renderTemplate, escapeHtml } from "@convetlib/templates";
const result = renderTemplate("Nomor {{ surat.nomor }}", { surat: { nomor: "001/2026" } }, { strict: true, escape: escapeHtml });
```

## Prasyarat

Pastikan perangkat pengembangan memiliki:

- **Node.js 20 atau lebih baru**.
- **pnpm 12.14.0** (versi yang dicantumkan di root `package.json`).
- Git.
- Browser yang didukung Playwright untuk menjalankan browser integration tests.

Periksa versi:

```powershell
node --version
pnpm --version
git --version
```

Jika pnpm belum tersedia dan instalasi Node mendukung Corepack:

```powershell
corepack enable
corepack prepare pnpm@12.14.0 --activate
pnpm --version
```

Jika perintah Corepack tidak tersedia, pasang versi pnpm yang sesuai melalui metode instalasi resmi yang digunakan tim Anda.

## Instalasi dari source

### 1. Clone repository

```powershell
git clone https://github.com/priambodo596-byte/libpos.git
cd libpos
```

Jika source sudah ada di komputer pengembangan pada `B:\\convetlib`, pindah ke direktori tersebut dan lewati langkah clone:

```powershell
Set-Location B:\\convetlib
```

### 2. Pasang dependency

Jalankan dari root monorepo:

```powershell
pnpm install --frozen-lockfile
```

Jika lockfile sengaja berubah karena pembaruan dependency, tinjau perubahannya terlebih dahulu, lalu jalankan `pnpm install` dan commit `pnpm-lock.yaml` bersama perubahan yang disetujui.

### 3. Build semua package

```powershell
pnpm build
```

Output build package ditulis ke direktori `dist/` masing-masing package. Direktori hasil build tidak disimpan ke Git karena diabaikan oleh `.gitignore`.

### 4. Jalankan pemeriksaan lengkap

```powershell
pnpm run verify
```

Perintah tersebut menjalankan build, typecheck, dan unit test semua package workspace. Untuk menjalankan integrasi browser editor pada ketiga browser:

```powershell
pnpm --filter @convetlib/editor test:browser:all
```

Browser yang diperlukan Playwright mungkin perlu diinstal sekali pada mesin baru:

```powershell
pnpm --filter @convetlib/editor exec playwright install chromium firefox webkit
```

Pada lingkungan CI yang tidak memiliki dependency sistem browser, lihat instruksi Playwright untuk memasang dependency OS yang dibutuhkan.

## Perintah pengembangan

Jalankan perintah berikut dari root repository:

| Perintah | Kegunaan |
|---|---|
| `pnpm install --frozen-lockfile` | Memasang dependency berdasarkan lockfile |
| `pnpm build` | Build seluruh package |
| `pnpm test` | Menjalankan unit test seluruh package |
| `pnpm typecheck` | Typecheck seluruh package |
| `pnpm run verify` | Build + typecheck + unit test |
| `pnpm --filter @convetlib/core test` | Unit test package core |
| `pnpm --filter @convetlib/editor test` | Unit test package editor |
| `pnpm --filter @convetlib/editor test:browser` | Browser integration default (Chromium) |
| `pnpm --filter @convetlib/editor test:browser:all` | Browser integration Chromium, Firefox, dan WebKit |
| `pnpm --filter @convetlib/ui test` | Unit test package UI |
| `pnpm --filter @convetlib/templates test` | Unit test template/placeholder engine |
| `pnpm --filter @convetlib/templates typecheck` | Typecheck template/placeholder engine |

Setelah mengubah kode, jalankan minimal `pnpm run verify`. Jika perubahan menyentuh browser binder, DOM selection, clipboard, atau event input, jalankan juga browser integration tests.

## Struktur repository

```text
.
â”œâ”€â”€ docs/
â”‚   â”œâ”€â”€ architecture/
â”‚   â”‚   â”œâ”€â”€ overview.md
â”‚   â”‚   â””â”€â”€ adr/
â”‚   â””â”€â”€ stage-reports/
â”œâ”€â”€ packages/
â”‚   â”œâ”€â”€ core/
â”‚   â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â””â”€â”€ test/
â”‚   â”œâ”€â”€ editor/
â”‚   â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â””â”€â”€ test/
â”‚   â””â”€â”€ ui/
â”‚       â”œâ”€â”€ src/
â”‚       â””â”€â”€ test/
â”œâ”€â”€ package.json
â”œâ”€â”€ pnpm-lock.yaml
â”œâ”€â”€ pnpm-workspace.yaml
â””â”€â”€ README.md
```

## Konfigurasi dan penggunaan dasar

Contoh berikut menggunakan package workspace secara langsung. Pastikan dependency sudah dipasang dan package telah di-build.

### 1. Buat dokumen dan instance editor

Contoh TypeScript:

```typescript
import {
  createDocument,
  createNodeFactory,
  createEditor,
} from "@convetlib/core";
import {
  registerEditingCommands,
  getTextBlocks,
  setSelection,
} from "@convetlib/editor";

const nodes = createNodeFactory();
const document = createDocument({
  id: "document-example",
  title: "Dokumen Contoh",
  language: "id-ID",
  content: [
    nodes.heading(1, "Dokumen Pertama"),
    nodes.paragraph("Dibuat dengan convetlib."),
  ],
});

const editor = await createEditor({ document });

// Daftarkan perintah editing ke instance editor.
const unregisterCommands = registerEditingCommands(editor);

// Baca blok teks dari model.
console.log(getTextBlocks(editor.state));

// Contoh: tempatkan caret di akhir blok teks pertama.
const firstTextBlock = getTextBlocks(editor.state)[0];
if (firstTextBlock) {
  setSelection(editor, {
    anchor: { blockId: firstTextBlock.id, offset: firstTextBlock.text.length },
    head: { blockId: firstTextBlock.id, offset: firstTextBlock.text.length },
  });
}

// Jalankan command setelah selection siap.
const result = editor.commands.execute("text.insert", { text: " Teks tambahan" });
if (!result.ok) {
  console.error("Perintah gagal:", result.reason);
}

// Simpan/serialisasi state dokumen melalui mekanisme aplikasi host.
const savedDocument = editor.state.document;
console.log(savedDocument);

// Bersihkan resource saat instance tidak lagi dipakai.
unregisterCommands();
await editor.destroy();
```

`createEditor` bersifat asynchronous karena lifecycle plugin dan koneksi adapter dapat bersifat asynchronous. Perubahan dokumen dilakukan melalui transaction/command; hindari mengubah object state secara langsung. State dari `editor.state` adalah snapshot yang tidak boleh dimutasi oleh aplikasi host.

### 2. Mengatur mode read-only

```typescript
const editor = await createEditor({
  document,
  editable: false,
});

// Aktifkan kembali jika izin aplikasi mengizinkan.
editor.setEditable(true);
```

Mode read-only di core adalah kontrol editing dasar, bukan pengganti authorization pada backend. Aplikasi host tetap harus menerapkan autentikasi, otorisasi, audit log, dan aturan penyimpanan yang diperlukan.

### 3. Mengamati perubahan state

```typescript
const unsubscribe = editor.on("state:change", ({ state, transaction }) => {
  console.log("Versi dokumen:", state.version);
  console.log("Transaksi:", transaction.meta.origin);
  // Jika dibutuhkan, aplikasi host dapat menjadwalkan penyimpanan state.document.
});

// Saat listener tidak diperlukan:
unsubscribe();
```

Implementasi persistence harus disediakan aplikasi host atau adapter yang sesuai. Core tidak memerlukan database maupun server secara otomatis.

### 4. Undo dan redo

```typescript
if (editor.history.canUndo) editor.history.undo();
if (editor.history.canRedo) editor.history.redo();
```

History yang tersedia saat ini adalah undo/redo lokal berbasis snapshot. Ini bukan collaborative undo dan tidak boleh dianggap sebagai strategi undo aman untuk sesi multi-user.

### 5. Toolbar tanpa framework tertentu

```typescript
import { DEFAULT_TOOLBAR, getToolbarState } from "@convetlib/ui";

const toolbarState = getToolbarState(editor, DEFAULT_TOOLBAR);
console.log(toolbarState);
// UI host merender tombol dan menghubungkan aksi ke editor.commands.
```

Package UI hanya menyediakan model data/state toolbar; komponen visual, styling, accessibility rendering, dan interaksi UI final merupakan tanggung jawab aplikasi adapter/host.

## Integrasi browser

`bindBrowserEditor` menghubungkan instance editor ke elemen DOM yang dirender oleh aplikasi host. Fungsi ini **tidak membuat renderer dokumen lengkap**. Host tetap harus merender blok dokumen, menjaga identitas model, dan memanggil callback render saat state berubah.

Contoh pola integrasi:

```typescript
import { bindBrowserEditor } from "@convetlib/editor";

const binding = bindBrowserEditor(editor, {
  root: editableElement,
  render: () => renderDocument(editor.state.document),
  onError: (error) => console.error("Editor browser error:", error),
  readOnly: false,
});

// Saat komponen host dilepas:
binding.destroy();
```

Persyaratan untuk DOM yang dirender host:

- Elemen root harus berupa elemen HTML yang sesuai dan menjadi area editor.
- Setiap leaf text block harus memiliki atribut `data-block-id="<id-blok-model>"` yang cocok dengan ID node pada model.
- Widget inline yang perlu dihitung sebagai satu posisi model harus memakai penanda `data-inline-atom`.
- Host wajib menyediakan label/deskripsi aksesibilitas yang tepat; browser binder tidak menghasilkan desain UI lengkap.
- Sinkronkan render DOM dengan perubahan state model. Hindari membiarkan browser melakukan mutasi DOM teks yang tidak tercatat pada model.

Integrasi browser dan HTML importer memiliki cakupan yang konservatif. Uji HTML dari sumber aplikasi Anda sendiri sebelum menggunakannya untuk dokumen produksi.

## Arsitektur package

| Package | Peran | Status |
|---|---|---|
| `@convetlib/core` | Model, schema, engine, transactions, events, plugins, adapter contracts | Fondasi tersedia |
| `@convetlib/editor` | Editing commands, selection, clipboard helpers, browser binder | Primitif Stage 3 tersedia |
| `@convetlib/ui` | Toolbar model dan state derivation | Fondasi tersedia |
| `@convetlib/react` | Adapter React | Direncanakan |
| `@convetlib/web-components` | Adapter Web Components | Direncanakan |
| `@convetlib/layout` | Pagination dan layout halaman | Direncanakan |
| `@convetlib/docx` | Import/export DOCX | Ekspor semantik; impor mendukung gambar raster editable dan daftar dasar, fitur Word kompleks masih terbatas |
| `@convetlib/pdf` | Export PDF semantik | Fondasi ekspor tersedia; layout kompleks dan aksesibilitas PDF masih dikembangkan |
| `@convetlib/templates` | Template dan placeholder | Fondasi tersedia |
| `@convetlib/review` | Comments, suggestions, track changes | Direncanakan |

Package yang berstatus direncanakan pada tabel tersebut belum tersedia sebagai package implementasi dalam workspace saat ini. Package DOCX menyediakan ekspor semantik dan impor DOCX dasar; fidelitas penuh Word masih dalam pengembangan.

## Batasan saat ini

Repository ini sedang dikembangkan dan **belum merupakan editor dokumen enterprise lengkap yang siap dipakai produksi tanpa integrasi tambahan**.

- Belum ada renderer UI lengkap atau adapter React/Web Components.
- DOCX import/export tersedia dalam cakupan semantik dasar; import belum mempertahankan semua fitur Word dan pagination engine lengkap belum tersedia. PDF table layout supports weighted columns, wrapped cell text, and repeated first-row headers when tables continue to another page; merged-cell layout and splitting a single oversized row are not implemented. Fondasi pagination berbasis tinggi blok dari host serta aturan `keepWithNext` sudah tersedia; pemecahan baris paragraf dan aturan layout kompleks belum tersedia.
- Seleksi lintas section untuk blok teks tingkat atas pada body didukung dalam batas planner; seleksi lintas header/body/footer dan struktur bersarang lintas section tetap belum didukung.
- Clipboard struktural gambar/tabel serta impor HTML campuran paragraf-gambar-tabel tersedia dalam cakupan konservatif; fidelitas penuh HTML/CSS, tabel kompleks, dan impor gambar biner otomatis belum didukung.
- Pengujian IME sistem operasi nyata dan audit screen reader manual masih perlu dilakukan.
- Storage, autentikasi, authorization, dan persistence produksi harus disediakan oleh aplikasi host.
- Collaboration contracts tidak sama dengan implementasi algoritma sinkronisasi multi-user yang siap produksi.
- License masih `UNLICENSED`; package name dan kebijakan publikasi perlu disetujui.

Lihat [Architecture Overview](docs/architecture/overview.md), [Stage 1 report](docs/stage-reports/stage-1.md), [Stage 2 report](docs/stage-reports/stage-2.md), dan [Stage 3 report](docs/stage-reports/stage-3.md) untuk detail keputusan, scope, dan batasan.

## Troubleshooting

### pnpm tidak dikenali

Pastikan Node.js terpasang, aktifkan Corepack jika tersedia, lalu aktifkan versi pnpm yang digunakan repository. Buka terminal baru setelah mengubah PATH.

### Build atau typecheck gagal setelah clone

Jalankan dari root:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
```

Pastikan versi Node.js memenuhi `engines.node` dan dependency tidak terpasang sebagian.

### Browser test gagal karena browser belum terpasang

```powershell
pnpm --filter @convetlib/editor exec playwright install chromium firefox webkit
pnpm --filter @convetlib/editor test:browser:all
```

Jika CI memerlukan library sistem tambahan untuk browser, pasang dependency sesuai dokumentasi Playwright dan image OS yang digunakan.

### Command tidak tersedia

Pastikan perintah editing sudah didaftarkan pada instance yang sama:

```typescript
const unregister = registerEditingCommands(editor);
```

Command juga dapat menolak dijalankan jika selection tidak valid atau operasi tidak didukung oleh struktur dokumen. Periksa hasil `editor.commands.execute(...)` dan alasan kegagalannya; jangan mengasumsikan setiap command selalu dapat dijalankan.

### Perubahan tidak tersimpan

Core tidak menyimpan dokumen ke database secara otomatis. Dengarkan event `state:change` atau simpan `editor.state.document` melalui persistence layer aplikasi host. Tentukan strategi retry, conflict handling, dan authorization di sisi aplikasi.

## Lisensi dan distribusi

Package di dalam monorepo saat ini menyatakan `UNLICENSED`. Sebelum distribusi internal lintas tim atau publikasi npm:

1. Tentukan dan tinjau lisensi yang sesuai.
2. Konfirmasi nama final package dan scope registry.
3. Tinjau public API dan kompatibilitas semver.
4. Tentukan artefak distribusi, provenance, serta kebijakan security/maintenance.
5. Jalankan `pnpm run verify` dan browser matrix pada lingkungan CI yang bersih.

Sampai keputusan tersebut dibuat, anggap repository ini sebagai source pengembangan internal dan jangan mempublikasikan package ke registry publik.
