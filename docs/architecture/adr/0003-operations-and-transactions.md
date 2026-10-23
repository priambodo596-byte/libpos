# ADR 0003 — Operations, transactions, commands, events

Status: accepted. Contracts defined in Stage 1; core transaction engine implemented in Stage 2. See `docs/stage-reports/stage-2.md`.

## Decision
- **Operation**: a small, JSON-serialisable description of one atomic change
  (`insert_text`, `delete_text`, `format`, `insert_block`, `remove_block`, `set_attrs`,
  `split_block`, `join_blocks`, `insert_inline`, plus document-level ops for meta, page,
  comments and revisions). Positions are `{ blockId, offset }`, not array paths, so they stay
  meaningful when other blocks move (important for collaboration and comments).
- **Transaction**: an ordered list of operations applied atomically, with `meta`
  (origin, timestamp, author, `addToHistory`). Either all operations apply or none do.
- **Command**: a named, user-facing action (`"text.toggleBold"`) that *produces* a transaction
  from the current state. Commands never mutate state directly.
- **Events**: a typed map (`EditorEventMap`); subscription returns an unsubscribe function.
- The only write path into a document is `Editor.dispatch(transaction)`.

## Why
Undo/redo, track changes, version history, plugin hooks and collaboration all need a single
serialisable change format. Letting each feature invent its own would duplicate logic and make
adapters diverge.

## Open points
- Operation inversion rules (for undo) are specified in Stage 2 alongside the implementation.
- Rebase/transform behaviour for concurrent operations is decided in Stage 7 (ADR 0005).
