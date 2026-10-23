# Stage 3 — Rich-text Editing Primitives and Framework-neutral UI Model

Status: **IN PROGRESS - editing primitives and undo/redo checks passed; Stage 3 is not closed (see "Remaining Stage 3 work")**  
Date: 2026-10-23  
Repository: `B:\\convetlib`

## Delivered

- New `@convetlib/editor` workspace package depending on `@convetlib/core`.
- Built-in command registration API: `registerEditingCommands(editor, options)` and command factory `createEditingCommands(options)`.
- Text insertion at caret, replacement of selected text, backward and forward deletion, and block splitting with caret placement.
- Deletion and replacement of selections spanning sibling text paragraphs in the same parent list, including paragraphs nested inside table cells/list containers; removes intervening paragraphs and joins the surviving text. Forward/reversed anchor/head order is supported when both endpoints share that sibling list.
- Selection, deletion, typed replacement and Enter across different parents (list items, blockquotes, nested lists, table cells, and mixed top-level/nested endpoints) within one section and slot, through a dedicated planner (`packages/editor/src/structure.ts`) that emits ordinary serializable operations; see "Cross-parent editing rules".
- Paragraph/heading conversion through a new serializable `set_node_type` operation; block alignment; bold, italic, underline, and strike toggles across non-empty selections spanning supported text blocks.
- `table.deleteRow` and `table.deleteColumn` commands with selection relocation and safe guards for last-row/column, ragged tables, and merged cells.
- `setSelection` helper using the editor's transaction path and `getTextBlocks` read helper for framework-neutral consumers and tests.
- Framework-neutral keyboard shortcut dispatcher plus `bindBrowserEditor`, a DOM adapter that wires keyboard, beforeinput, selectionchange, copy/cut/paste and composition events to the model; verified in Chromium browser automation for text-block selection mapping, typing, native clipboard operations, composition event ordering, and cross-block deletion.
- Clipboard APIs for copy/cut/paste with paragraph-aware rich fragments across supported text blocks and parent structures, preserving supported inline marks and paragraph boundaries; HTML/plain-text bridge contracts and a conservative HTML importer are included. HTML import preserves heading levels, and multi-block paste preserves the final pasted block type while joining the target suffix.
- IME composition buffer utility plus browser composition event handling that commits the final composition text once and avoids normal beforeinput insertion during active composition.
- Accessibility semantics helper describing textbox role, label, multiline/read-only state, description, and keyboard shortcuts; the browser binder applies textbox/multiline/read-only attributes, while label and description remain host-provided. Added a Chromium axe-core audit against WCAG 2.0/2.1 A/AA rules for the integration fixture; no automated violations were reported.
- Fixed nested operation traversal to preserve mutable child-list identity for nested remove/join/split operations.
- Core history controller with `canUndo`, `canRedo`, `undo()`, `redo()`, and `clear()`; records successful document-changing local transactions, caps history at 200 entries, clears redo on a new edit, skips remote/explicitly excluded changes, and resets history when replacing the document.
- Undo/redo restores immutable document snapshots and selection through the engine state-change event path; it increments the editor version and is disabled in read-only mode.
- New `@convetlib/ui` package with `DEFAULT_TOOLBAR` and `getToolbarState` for deriving enabled/active controls without DOM or framework dependencies.
- Added editor and UI package manifests/build configs and unit tests.
- Root `verify` script now builds workspace packages before typecheck and tests, so dependent package declaration outputs exist during typechecking.
- Updated architecture overview and operation contract coverage for `set_node_type`.

## Cross-parent editing rules

Apply to `text.insert`, `text.deleteBackward`, `text.deleteForward` and `block.split` when the selection endpoints are in different blocks.

- Both endpoints must be text blocks (paragraph, heading, code block) in the same section and slot. Otherwise the command is unavailable, and if invoked directly it refuses without changing the document.
- Selected text is deleted at both ends. Blocks lying completely inside the selection are removed. Table rows and cells are emptied instead (a fresh empty paragraph is kept) so the grid is never broken; a table lying completely inside the selection is removed.
- The tail of the end block is merged into the start block only when all of these hold: both are inside the same table cells (or neither is in a table), the kinds are compatible (a code block is never merged with a paragraph or heading), and every container that would be left empty is removable (list item, blockquote, list). Otherwise the two blocks stay separate and only the selected text is deleted.
- A merged tail keeps its inline marks and inline atoms.
- Enter deletes the selection and then splits at the caret. Typing replaces the selection and places the caret after the typed text.
- Checking availability (`canRun`) never allocates ids. The engine's schema validation still rejects any invalid result atomically.
- Undo restores the previous document structure (compared excluding `meta.updatedAt`, which the engine refreshes on every dispatch, undo included).

Observations, not changed here:

- The core engine also refreshes `meta.updatedAt` on selection-only dispatches. If persistence or collaboration "dirty" checks rely on that field, this may be unintended and should be reviewed.
- From reading the previous code: `text.insert` with a multi-block selection it could not handle fell back to the end of the first text block of the document. It now refuses; this is covered by a test.

## Intended usage

```ts
import { createEditor } from "@convetlib/core";
import { registerEditingCommands, setSelection } from "@convetlib/editor";
import { getToolbarState } from "@convetlib/ui";

const editor = await createEditor();
const unregisterCommands = registerEditingCommands(editor);
// A host UI sets selection from its own input/selection bridge.
const toolbar = getToolbarState(editor);
// On teardown:
unregisterCommands();
await editor.destroy();
```

## Scope limits

- This is not a rendered editor, website, dashboard, React adapter, or Web Component.
- Multi-block editing works across parents within one section and slot (see "Cross-parent editing rules"). Selections across sections or between header/body/footer, and endpoints that are not paragraph, heading, or code-block text leaves remain explicitly refused. Mark toggles, heading conversion and alignment support multi-block selections within one section and slot. Copy/cut across different parents is supported when the structural planner accepts the range. Browser selection mapping is verified for tagged text-block DOM points and inline atoms tagged `[data-inline-atom]`, which count as one model position. Arbitrary rendered widgets still require the host to expose a stable inline-atom marker.
- Browser automation (`pnpm --filter @convetlib/editor test:browser`) now runs against Chromium. It covers text insertion, DOM selection mapping across text and marked inline atoms, native clipboard copy/cut/paste, synthetic composition event ordering, supported cross-block deletion, and an axe-core WCAG 2.0/2.1 A/AA automated scan of the fixture. The host still owns rendering and must provide an accessible label/description. This is not a screen-reader audit, and synthetic composition events do not replace testing with an actual operating-system IME.
- Clipboard: paragraph-aware internal fragments support copy/cut across text blocks when the structural planner accepts the selection, and multi-paragraph rich paste into a single target text block. HTML import preserves heading levels and basic nested marks, ignores imported attributes, and drops supported active-element contents. Unit tests cover safe HTML import, HTML/plain-text serialization, oversized-input rejection, and multi-block paste preserving the suffix and final block type. Native text clipboard copy/cut/paste passed the Chromium integration test. The injected bridge can read/write text/html when the host implements those optional methods. Not implemented: image/table clipboard payloads, full HTML/CSS fidelity, or replacement of a selection spanning multiple destination blocks.
- Table commands `table.deleteRow` and `table.deleteColumn` are implemented. Row deletion is disabled for the last row; column deletion requires a rectangular table with at least two columns and no merged cells. Ragged rows and rowspan/colspan cases are refused rather than guessed.
- Mark toggles require a non-empty selection. Stored marks for future typing at a collapsed caret are not implemented.
- Toolbar active-state derivation currently targets top-level blocks; a UI host should bridge selection and nested-block context.
- Undo/redo now exists as a basic core history controller. It restores document snapshots rather than generating inverse collaborative transactions, so it is not yet a collaborative undo system.
- Pagination, DOCX/PDF, templates, comments/review UI, and collaboration algorithms remain future stages.
- Package license remains `UNLICENSED`; do not publish until licensing and package naming are approved.

## Verification

- Core build: PASS (ESM, CJS, `.d.ts`, `.d.cts`).
- Workspace build: PASS for core, editor, and UI packages.
- Workspace typecheck: PASS after the package build step.
- Core tests: 98/98 PASS.
- Editor unit tests: 56/56 PASS (editing.test.ts 8, interaction.test.ts 16, cross-parent.test.ts 22, table-commands.test.ts 5, clipboard.test.ts 5), including table row/column deletion constraints and rich clipboard interoperability.
- UI tests: 1/1 PASS.
- Latest `pnpm run verify`: PASS, exit code 0; 155 unit tests passed across 12 test files (core 98, editor 56, UI 1). Browser integration is a separate additional test run and also passed on 2026-10-23.
- Counts reconciled with the latest verification on 2026-10-23 after adding five clipboard tests.
- Cross-parent tests (22) check the resulting document structure, not only text: list items and nested lists, mixed top-level/list/blockquote endpoints, tables kept intact (cells and rows emptied, never merged or removed), a table swallowed whole, inline marks of the merged tail, code block vs paragraph, reversed selections, Backspace and Enter through the shortcut dispatcher, typed replacement, undo, refusal across sections, header/body and non-text endpoints (through `execute` and through `run()` directly), and no id allocation while only checking availability.
- Test-strength check: two guards were sabotaged one at a time. Allowing merges across table structure was caught by the table test. Removing the unsupported-span guard in `text.insert` was initially NOT caught, because `execute()` refuses through `canRun` first; a test calling `run()` directly was added and then caught it. The sabotaged files were restored and verified byte-identical by hash.

## Remaining Stage 3 work (partially delivered)

Stage 3 remains open until the remaining boundaries are implemented and tested or explicitly accepted as out of scope:

1. Selections across sections and between header/body/footer remain refused. Endpoints in non-text blocks and arbitrary rendered widgets remain unsupported unless the host renders them as text leaves or stable `[data-inline-atom]` elements.
2. Native plain-text clipboard copy/cut/paste passed in Chromium, and HTML bridge behavior has unit coverage for basic marks and headings. Cross-browser rich HTML interoperability, images/tables in clipboard payloads, and replacing a selection that already spans multiple destination blocks remain incomplete.
3. Browser integration tests cover Chromium and synthetic composition event ordering; actual operating-system IME behavior and Firefox/WebKit differences remain untested.
4. axe-core WCAG 2.0/2.1 A/AA checks passed for the integration fixture, but a full host-UI review and screen-reader testing remain outstanding.
