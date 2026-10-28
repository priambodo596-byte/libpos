# Stage 46 — Bound free-positioned PDF images to the page

## Changes
- Free-positioned images are scaled down when their requested dimensions exceed the physical page size.
- Aspect ratio is preserved and the existing coordinate clamp keeps the image rectangle inside the page bounds.
- Added a regression test for a 2000 × 1000 CSS-pixel image; it verifies the rendered rectangle fits within the page and retains a 2:1 aspect ratio.

## Verification
- PDF tests passed: 24 tests across 3 files.
- Full monorepo verification and whitespace checks are run before this stage is committed.

## Remaining limitations
- Clamping ensures an image is inside the page, but does not detect semantic overlap with text or other floating images.
- Very tall table groups connected by rowspan still need a dedicated split strategy.
- Exact font parity still requires appropriate embedded font files.
