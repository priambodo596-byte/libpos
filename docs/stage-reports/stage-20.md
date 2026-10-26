# Stage 20 — Keep images inside their DOCX list items

## Delivered

- Numbered and bulleted paragraphs now attach supported block-level images to the matching `listItem` node.
- Images no longer get collected and appended after the complete list, which could break the relationship between a list entry and its illustration.
- Added a synthetic DOCX fixture with an image in the first numbered item and a text-only second item; assertions verify the image remains in the first item and no extra image node is emitted outside the list.

## Verification

- `pnpm run verify`: passed (build, typecheck, and all 196 workspace tests).
- DOCX package: 12 tests passing; core 98, editor 70, templates 6, PDF 9, UI 1.
- Visual proof: `stage-20-list-image-proof.png`, rendered from a local HTML evidence page and based on the tested fixture structure. It is not a Microsoft Word application screenshot.

## Scope and limitations

- Images remain block-level nodes inside a list item; true inline image placement within a text run is not represented by the current core model.
- Only supported embedded raster images that resolve through the document relationships are imported.
