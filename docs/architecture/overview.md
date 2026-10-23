# convetlib — Architecture Overview

convetlib is an **Enterprise Document Editor Library/SDK**. It is a set of npm packages
consumed by other applications. It is *not* a SaaS product: there is no website, dashboard,
login, billing or mandatory backend in this repository. Playgrounds/examples (under `examples/`)
exist only to prove the library works.

Status legend: **[S1]** = delivered in Stage 1, **[S2]** = delivered in Stage 2, **[S3 partial]** = Stage 3 primitives delivered, stage not closed (see docs/stage-reports/stage-3.md), **[planned: Sn]** = designed here, built in Stage n.

## Package map

| Package | Responsibility | Depends on | Stage |
|---|---|---|---|
| `@convetlib/core` | Document model, schema, migrations, **engine**, transactions, commands, events, plugin runtime and adapter contracts. | nothing (no DOM, no Node APIs, no React) | **[S1]** model + contracts, **[S2]** engine |
| `@convetlib/editor` | Rich-text editing behaviour, built-in commands, selection handling | core | **[S3 partial]** |
| `@convetlib/ui` | Framework-neutral toolbar model and derived control state | core, editor | **[S3 partial]** |
| `@convetlib/react` | React adapter over the same core instance | core, editor, ui, `react` (peer) | [planned: S4] |
| `@convetlib/web-components` | Custom-element adapter over the same core instance | core, editor, ui | [planned: S4] |
| `@convetlib/layout` | Page layout engine (pagination, headers/footers, page numbers) | core | [planned: S5] |
| `@convetlib/docx` | DOCX import/export, implements the `conversion` contracts | core | [planned: S5] |
| `@convetlib/pdf` | PDF export, implements the `conversion` contracts | core, layout | [planned: S5] |
| `@convetlib/templates` | Template / placeholder engine | core | [planned: S6] |
| `@convetlib/review` | Comments, suggestions, track changes, version history | core | [planned: S7] |
| `@convetlib/testing` | Test utilities (fake storage/collab adapters, document builders) | core | [planned: S8, earlier where needed] |

Plugins for tables, images, lists, headers/footers and page numbers are published as
separate entry points or packages that use only the public Plugin API.

## Dependency rules (enforced)

1. `@convetlib/core` has **zero runtime dependencies** and must not reference `react`, `next`,
   DOM globals, or Node built-ins. This is checked by `test/architecture.test.ts`.
2. Adapters (`react`, `web-components`) contain **no editor logic**; they only bind a core
   `Editor` instance to a UI technology.
3. Databases and storage are reached only through the `StorageAdapter` contract.
4. Collaboration transport is reached only through the `CollaborationAdapter` contract.
5. DOCX and PDF live in their own packages and are optional.

## Data flow

```
user input / API call
        │
        ▼
   command ──► Transaction { ops[] } ──► Editor.dispatch ──► new EditorState
                                              │                    │
                                              ├── events ──────────┤ (subscribers, adapters)
                                              ├── plugin hooks     │
                                              └── collaboration.send (local changes)
```

The document is plain JSON (`DocumentJSON`). Every change is a `Transaction` made of
serialisable `Operation`s, which is what makes undo/redo, track changes, version history and
collaboration possible without each module inventing its own change format.

## Stage 1 and Stage 2 delivery boundary

Stage 1 delivered the versioned JSON document model, schema validation, migration registry,
node factory, public TypeScript contracts, architecture decision records, and foundational tests.

Stage 2 adds a running framework-neutral editor engine: `createEditor`, immutable state snapshots,
atomic transaction dispatch, command registry, typed events, plugin lifecycle and hooks, and an
optional collaboration adapter bridge. See `docs/stage-reports/stage-2.md` for acceptance evidence
and known limitations.

Stage 3 adds `@convetlib/editor` editing commands for text insertion/replacement, backward/forward
delete (including sibling paragraph selections in nested contexts such as a table cell), block splitting,
paragraph/heading conversion, alignment, selected-text marks, and boundary joins. It also adds
framework-neutral keyboard shortcut mapping, plain-text clipboard helpers and an injectable clipboard
bridge, an IME composition buffer, accessibility semantics metadata, `@convetlib/ui` toolbar state,
and a basic core undo/redo history controller for local document-changing transactions.
See `docs/stage-reports/stage-3.md` for exact scope and limitations.

DOCX/PDF compatibility, pagination, React/Web Components adapters, cross-parent nested selections,
DOM event wiring, actual accessibility rendering/audits, rich clipboard fragments, and production
readiness are not claimed by Stages 1-3. Keyboard/clipboard/IME utilities require adapter integration.
Undo/redo is currently snapshot-based local history, not collaborative undo.

## Open decisions (need an owner decision or a later stage)

- **License**: `packages/core/package.json` says `UNLICENSED`. A distributable library needs a
  real license before any publish.
- **Collaboration algorithm** (OT vs CRDT vs server-ordered rebase): the contract is
  transport-level and deliberately neutral; the concrete strategy is decided in Stage 7.
- **Text measurement for layout/PDF**: font metrics provider design is decided in Stage 5.
- **Package scope/name** `@convetlib/*` is a working name; confirm before first publish.
