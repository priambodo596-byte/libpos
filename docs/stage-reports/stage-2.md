# Stage 2 - Core Engine Lifecycle, Transactions, Commands, Events & Plugin Runtime

Status: **PASS - Stage 2 acceptance criteria met**  
Date: 2026-10-23  
Repository: `B:\\convetlib`

## Implemented

- Public async `createEditor(options)` factory, exported from `@convetlib/core`.
- Initial document migration and schema validation at editor creation.
- Immutable editor state snapshots with monotonically increasing state version.
- Central `dispatch(transaction)` write path with transaction shape and base-version checks.
- Atomic operation application: changes are made against a draft, and the draft replaces current state only if every operation applies and the resulting document passes schema validation.
- Operation handlers for text insertion/deletion, formatting marks, inline/block insertion, block removal, attributes, split/join blocks, section insertion/removal, page setup, metadata, comments and revision records/status.
- Typed event bus with unsubscribe/once support and isolation of throwing event handlers.
- Command registry with unique IDs, `can`, `execute`, and dispatch-based transaction application.
- Plugin lifecycle: manifest checks, core-version range checks, dependency checks, schema extension, activation/deactivation, status events, before-dispatch allow/reject/replace hooks, and cleanup callbacks.
- Cooperative plugin permission checks for document read/write, event subscriptions and command registration/execution.
- Optional collaboration adapter connection and remote transaction delivery; no collaboration server or algorithm is bundled.
- Idempotent editor destruction, plugin cleanup, event cleanup and collaboration disconnect handling.
- Unit tests covering editor lifecycle, atomic rollback, read-only mode, stale transactions, command execution, plugin hooks, plugin schema extension/unregistration and document replacement.

## Verification

Root workspace command `pnpm verify` completed with exit code 0.

- TypeScript typecheck: PASS.
- Unit tests: **95/95 PASS** across 6 test files.
- Build: ESM, CJS, `.d.ts`, and `.d.cts` outputs succeeded.
- ESM package smoke test: PASS.
- Core architecture tests: PASS; framework-neutral core has no runtime dependencies and avoids browser/Node globals.

## API and file locations

- Engine implementation: `packages/core/src/engine/index.ts`
- Public export: `packages/core/src/index.ts`
- Engine tests: `packages/core/test/engine.test.ts`

## Known limitations / not claimed as complete

1. Undo/redo and inverse-operation history are not implemented in this stage.
2. Persistent storage is defined as a contract but automatic load/save and optimistic persistence lifecycle are not implemented.
3. Collaboration currently wires the adapter and dispatches adapter-provided remote transactions. OT/CRDT, rebasing, presence UX, reconnect policy and server protocol remain later-stage work.
4. Plugin permission checks are API-level guardrails, not a security sandbox for untrusted JavaScript.
5. Semver range support in the current minimal plugin compatibility helper is intentionally limited; it is not a full npm semver implementation.
6. DOCX/PDF conversion, pagination, rich-text UI, React and Web Components adapters, templates and review UI are not implemented yet.
7. The editor has not been declared production-ready; further adversarial, performance and interoperability tests are required.

## Gate

**Stage 2 is closed for the defined core engine lifecycle and plugin runtime scope.** Proceed to Stage 3 (rich-text editing primitives and UI-independent editing behavior) as a separate implementation stage. Do not treat the limitations above as delivered features.
