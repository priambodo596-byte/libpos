# Stage 16 - DOCX links and section header/footer import

## Implemented

- Hyperlink relationships marked external are retained only for `http`, `https`, and `mailto` schemes. Hyperlink text is imported with a `link` mark containing the URL; internal Word anchors are represented as `#anchor` links.
- Unsafe/unsupported URL schemes are not imported as link marks. External relationships other than safe hyperlinks remain excluded from package-part resolution.
- Imports default section header and footer references into the core section's `header` and `footer` block arrays.
- Adds a synthetic OOXML fixture test covering safe hyperlink marks and header/footer text.
- Updates README feature scope and limitations.

## Verification

- DOCX package typecheck passed.
- DOCX package tests: 8 tests passed.
- Full workspace `pnpm run verify`: passed; build and typecheck passed and all **192 tests passed** (core 98, editor 70, templates 6, DOCX 8, PDF 9, UI 1).
- `git diff --check`: passed.

## Scope / remaining work

- Only the default header/footer reference is imported. First/even-page variants and header/footer image relationships are not handled yet.
- Header/footer block parsing currently covers supported paragraphs and tables using the document relationship map.
- Hyperlinks are represented as marks on text nodes; renderer and export adapters must explicitly honor link marks for clickable/rendered output.
- Custom/inherited styles, hyperlink styling, nested list levels, per-section relationship differences, comments/revisions, floating objects, and exact Word layout remain unsupported.
