# ADR 0005 — Adapter contracts (storage, collaboration, conversion)

Status: accepted (Stage 1, contracts only).

## Storage (`StorageAdapter`)
Async, backend-agnostic: `load`, `save`, optional `delete`/`list`. `save` takes an
`expectedRevision` for optimistic concurrency and returns a discriminated result
(`ok` | `conflict` | `error`) instead of throwing, so callers handle conflicts explicitly.
Assets (images) and version history are separate optional capabilities
(`AssetStorageAdapter`, `VersionStorageAdapter`) so a minimal backend need not implement them.
Binary data is `Uint8Array` (no DOM `Blob` in core).

## Collaboration (`CollaborationAdapter`)
Transport-level only. The adapter connects a document session, sends local transactions,
delivers remote transactions, and reports status and presence. It connects to a backend
**owned by the library user**; nothing in this repo is a required server.
The adapter contract does **not** choose OT vs CRDT: remote changes arrive as transactions
already positioned against the local document version, and the integrator (or a Stage 7
reference strategy) is responsible for ordering/rebasing. This is an explicit open decision.

## Conversion (`DocumentImporter` / `DocumentExporter`)
Format packages (DOCX, PDF) implement generic importer/exporter contracts and report
**`ConversionWarning`s** for anything they could not represent faithfully. This is how the
library avoids claiming compatibility it has not verified: fidelity loss is surfaced per
conversion, and the compatibility matrix lists only constructs covered by tests.
