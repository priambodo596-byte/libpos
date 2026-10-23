# ADR 0001 — Monorepo and package boundaries

Status: accepted (Stage 1)

## Context
The product is a library consumed by third parties. Consumers must be able to install only
what they need (e.g. core without DOCX, or the Web Components adapter without React).

## Decision
- pnpm workspace monorepo: `packages/*` (published), `examples/*` (dev-only, never published).
- Each package ships ESM + CJS + `.d.ts` via `tsup`, `sideEffects: false`, explicit `exports` map.
- `@convetlib/core` is dependency-free and environment-neutral (ES2022 only, no DOM/Node typings
  in its `src` tsconfig). Tests use a separate tsconfig that adds Node typings.
- Adapters and format packages depend on core, never the other way round.

## Consequences
- Boundary violations are caught mechanically (`test/architecture.test.ts`).
- Adding a package never requires changing core, provided it uses the public contracts.
