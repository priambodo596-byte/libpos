# Stage 47 - Multi-page letterhead and repeating margin content

## Changes
- Added a regression test that exports a three-page document with a section letterhead paragraph and image, a repeating margin header, and a page-numbered footer.
- Verifies the section header text and image are rendered on every page, the margin header repeats, and footer tokens resolve to the correct page number and total page count.
- No renderer behavior change was needed: the existing page-layout pass already applies section regions and margin content to each generated page.

## Verification
- PDF package tests pass: 25 tests across 3 files.
- Full monorepo verification is run before committing this stage.

## Remaining limitations
- These tests verify repeated rendering and page-number token resolution, not visual collision detection between letterhead artwork and body content.
- Multi-row table groups connected by rowspan still need a dedicated continuation strategy when taller than a page.
