# Stage 27 — Fields Manager CRUD

## Delivered

- Replaced the temporary custom-field button with a structured form for label, field key, and a data-type selector.
- Added field-key validation: keys must start with a letter, use alphanumeric/underscore/hyphen segments separated by dots, and be no longer than 120 characters.
- Duplicate field keys are rejected before mutating the document.
- Added Edit action to rename field keys across placeholder nodes and inline `{{key}}` text, and update the display label.
- Added Delete action with confirmation; removes matching placeholder nodes and literal placeholder tokens across section content, headers, footers, and nested nodes.
- Uses `replaceModel` and core schema validation before accepting document mutations.
- Added responsive styling for the CRUD form and field action rows.
- Captured the actual UI screenshot at `docs/stage-reports/convetlib-fields-manager.png`.

## Verification

- Playground production build passed (Vite; existing chunk-size advisory remains).
- `http://127.0.0.1:5173/` returned HTTP 200 and served the new field CRUD form.
- `pnpm run verify` passed: build and typecheck for all six packages; all 199 tests passed (core 98, editor 73, DOCX 12, PDF 9, templates 6, UI 1).
- `git diff --check` to be run before commit.

## Manual checks

1. Add a unique field key such as `pegawai.nama_baru`; verify it appears in the field list and as a placeholder in the document model.
2. Attempt to add the same key again; it should be rejected.
3. Edit a field key and label; verify all matching placeholders update.
4. Delete a field and confirm; verify its placeholder nodes/tokens disappear.
5. Try an invalid key containing spaces or starting with a number; it should be rejected.

## Limitations

- Field labels and selected data types currently live in playground UI memory and are not persisted as a formal field-definition schema in the document model. Reloading or importing a document can reset this metadata.
- The type selector currently classifies the field in the playground; it does not yet enforce runtime data validation, formatting, or data binding for date/number/currency/boolean values.
- Edit uses browser prompts and delete uses a confirmation dialog; a polished inline/modal editor is a future UI refinement.
