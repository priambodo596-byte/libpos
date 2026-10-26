# Stage 23 — Semantic HTML list import

## Delivered

- Structural HTML clipboard import now activates for ordered and unordered lists in addition to tables and supported images.
- `<ul>` is represented as `bulletList`; `<ol>` as `orderedList`; `<li>` as `listItem` containing paragraph blocks.
- Nested lists are attached to their parent list item, preserving nesting and order.
- Ordered-list `start` is preserved when it is a positive numeric value, bounded to 1–100000; invalid values fall back to 1.
- Inline marks inside list items, including `<strong>`, are retained by the existing safe mark parser.
- Added regression coverage for nested ordered/unordered lists and inline bold formatting.

## Verification

- `pnpm --filter @convetlib/editor test`: 72 tests passed.
- `pnpm run verify`: successful; build and typecheck passed for all six workspace packages, all 198 workspace tests passed.
- `git diff --check`: run before commit.

## UI/UX evidence

The existing actual playground UI screenshot remains at `docs/stage-reports/convetlib-editor-ui-preview.png`. This stage changes HTML clipboard parsing, not the visual playground layout, so the screenshot documents the application UI rather than test output.

## Scope and limitations

This stage preserves semantic list structure during HTML clipboard import. It does not claim complete HTML/CSS layout fidelity or guarantee all third-party HTML constructs are supported.