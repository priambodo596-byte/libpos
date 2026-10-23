# ADR 0002 — Document model

Status: accepted (Stage 1). Implemented in `packages/core/src/model/`.

## Decision
- A document is **plain JSON** (`DocumentJSON`): no classes, functions, `Date`, `undefined`,
  `NaN`/`Infinity`. This keeps it storable, diffable, transmittable and testable.
- `schemaVersion` is an integer. Any breaking change bumps it and adds a `Migration`.
  `parseDocument()` is the only entry point for untrusted/stored input: migrate, then validate.
  Documents newer than the supported version are rejected, never guessed at.
- Structure: `sections[]` → blocks → inline nodes. Sections own page setup, header and footer,
  mirroring DOCX/PDF page semantics. Units are **twips** (1/1440 in), the DOCX unit, to avoid
  lossy unit conversion on import/export.
- Every block node and section has a stable string `id` (needed for comments, collaboration,
  operations and diffing). Inline nodes have no id and are addressed by (blockId, offset).
- Comments and revisions live in document-level maps; text refers to them through the
  `comment` / `insertion` / `deletion` marks. The validator reports dangling references.
- The schema is an immutable registry (`Schema.create().extend(...)`). Plugins add node/mark
  specs by producing a new schema; duplicate names are an error.

## Known limitations (tracked for later stages)
1. Text nodes are not required to be normalised (adjacent text nodes with identical marks are
   legal). Operations in Stage 2 must normalise; a `normalize()` helper is planned there.
2. `Revision.kind` allows `format` and `move`, but only `insertion`/`deletion` have anchoring
   marks. Format/move anchoring is a Stage 7 task.
3. Header/footer variants (first page, even/odd) are not modelled yet.
4. Comment/revision *anchors* are marks on text only; comments on non-text blocks (e.g. images)
   are not modelled yet.
