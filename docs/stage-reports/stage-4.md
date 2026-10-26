# Stage 4 — Template Engine Foundation

Status: **Implementation increment started; template renderer delivered, broader document-generation features remain in progress.**

## Delivered in this increment

- New framework-neutral `@convetlib/templates` workspace package.
- Scalar placeholders with nested paths (`{{ surat.nomor }}`), deterministic key listing, missing-value reporting, optional strict validation, and caller-provided escaping.
- No expression evaluation, function calls, prototype-chain traversal, or implicit object/array stringification.
- Unit tests for nested data, strict missing-value handling, HTML escaping, unsupported expressions, and falsy values.

## Not yet delivered by this increment

This package does not yet bind placeholders to document-model nodes, provide conditional/repeating sections, import/export DOCX, render PDF, or paginate documents. Those are separate follow-up implementations and must not be inferred from the renderer API alone.

## Verification

Run `pnpm --filter @convetlib/templates test`, `pnpm --filter @convetlib/templates typecheck`, then root `pnpm run verify`.
