# Stage 21 — Remove duplicate text placeholders for imported DOCX images

## Delivered

- DOCX drawing nodes are still imported as editable block-level image nodes by `imagesFromParagraph`.
- Removed the synthetic `[Image]` text emitted by the inline traversal for drawings. This avoids showing a duplicate text label beside the real image node in the imported document preview.
- Extended the list-image import fixture to assert that the paragraph retains only its original text while the corresponding image remains a sibling block inside the same list item.

## Verification

- `pnpm --filter @convetlib/docx test`: passed (12 tests).
- `pnpm run verify`: passed (build, typecheck, and all 196 workspace tests).

## Scope and limitations

- Images are still represented as block-level nodes; true inline image placement inside text runs is not yet represented by the document model.
- This stage improves semantic output and avoids a duplicate placeholder; it does not claim pixel-perfect Word layout fidelity.
