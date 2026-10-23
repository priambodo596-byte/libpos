import { cloneJson } from "./clone";
import { coreSchema, type Schema, type ValidationIssue } from "./schema";
import { SCHEMA_VERSION, type DocumentJSON } from "./types";

export type DocumentVersionErrorCode =
  | "not-an-object"
  | "missing-version"
  | "future-version"
  | "no-migration-path"
  /** Nested deeper than the supported limit, or cyclic. */
  | "invalid-structure";

export class DocumentVersionError extends Error {
  constructor(
    readonly code: DocumentVersionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentVersionError";
  }
}

/** Pure transformation from one schema version to the next. Must not mutate its input. */
export interface Migration {
  from: number;
  to: number;
  migrate(doc: unknown): unknown;
}

export interface MigrationResult {
  document: DocumentJSON;
  fromVersion: number;
  toVersion: number;
  /** `to` version of each migration that ran, in order. Empty when no migration was needed. */
  applied: number[];
}

export class MigrationRegistry {
  private readonly byFrom = new Map<number, Migration>();

  constructor(readonly target: number = SCHEMA_VERSION) {}

  register(m: Migration): this {
    if (m.to <= m.from) throw new Error(`Migration ${m.from}->${m.to} must increase the version`);
    if (this.byFrom.has(m.from)) throw new Error(`A migration from version ${m.from} is already registered`);
    this.byFrom.set(m.from, m);
    return this;
  }

  /** Migrates `input` to `target`. The input is cloned first and never mutated. */
  migrate(input: unknown): MigrationResult {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new DocumentVersionError("not-an-object", "Document must be a JSON object");
    }
    const version = (input as { schemaVersion?: unknown }).schemaVersion;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
      throw new DocumentVersionError("missing-version", "Document has no valid integer schemaVersion");
    }
    if (version > this.target) {
      throw new DocumentVersionError(
        "future-version",
        `Document schemaVersion ${version} is newer than the supported version ${this.target}`,
      );
    }

    let current: unknown;
    try {
      current = cloneJson(input);
    } catch (e) {
      // Input is untrusted: getters, proxies, cycles, and excessive depth can all make cloning
      // fail. Report these as document issues instead of leaking runtime exceptions to callers.
      const detail = e instanceof Error ? e.message : String(e);
      throw new DocumentVersionError(
        "invalid-structure",
        `Document structure could not be cloned: ${detail}`,
      );
    }
    let v = version;
    const applied: number[] = [];
    while (v < this.target) {
      const step = this.byFrom.get(v);
      if (!step) throw new DocumentVersionError("no-migration-path", `No migration registered from schemaVersion ${v}`);
      current = step.migrate(current);
      v = step.to;
      applied.push(v);
      const after = (current as { schemaVersion?: unknown } | null)?.schemaVersion;
      if (after !== v) {
        throw new DocumentVersionError("no-migration-path", `Migration to ${v} did not set schemaVersion to ${v}`);
      }
    }
    return { document: current as DocumentJSON, fromVersion: version, toVersion: v, applied };
  }
}

/** Registry used by `parseDocument`. Empty today because v1 is the first released schema. */
export const defaultMigrations = new MigrationRegistry(SCHEMA_VERSION);

export type ParseResult =
  | { ok: true; document: DocumentJSON; migrated: boolean }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Entry point for untrusted/stored documents: migrate to the current version, then validate.
 * Never throws for bad input; version problems are reported as issues.
 */
export function parseDocument(
  input: unknown,
  opts: { schema?: Schema; migrations?: MigrationRegistry } = {},
): ParseResult {
  const schema = opts.schema ?? coreSchema;
  const migrations = opts.migrations ?? defaultMigrations;
  let result: MigrationResult;
  try {
    result = migrations.migrate(input);
  } catch (e) {
    if (e instanceof DocumentVersionError) {
      const code = e.code === "future-version" || e.code === "no-migration-path" ? "unsupported-version" : "malformed";
      const path = e.code === "invalid-structure" || e.code === "not-an-object" ? "" : "schemaVersion";
      return { ok: false, issues: [{ code, path, message: e.message }] };
    }

    // A caller may supply hostile objects (including throwing getters/proxies) or a custom
    // migration that fails. The public parser must return an issue for these cases too.
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      issues: [{ code: "malformed", path: "", message: `Document could not be parsed safely: ${detail}` }],
    };
  }
  const issues = schema.validate(result.document);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, document: result.document, migrated: result.applied.length > 0 };
}
