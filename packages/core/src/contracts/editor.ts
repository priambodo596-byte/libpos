import type { DocumentJSON } from "../model/types";
import type { Schema, ValidationIssue } from "../model/schema";
import type { IdGenerator } from "../model/factory";
import type { CommandRegistry } from "./commands";
import type { CollaborationAdapter, UserInfo } from "./collaboration";
import type { EventSource } from "./events";
import type { PluginDefinition, PluginHost } from "./plugin";
import type { StorageAdapter } from "./storage";
import type { Selection, Transaction } from "./operations";

/** Immutable snapshot of an editor. A new object is produced by every successful dispatch. */
export interface EditorState {
  readonly document: DocumentJSON;
  readonly selection: Selection | null;
  /** Schema in effect, including extensions contributed by active plugins. */
  readonly schema: Schema;
  /** Starts at 0 and increases by one for every applied transaction. */
  readonly version: number;
}

export type DispatchErrorCode =
  | "invalid-operation"
  | "schema-violation"
  | "rejected-by-plugin"
  | "permission-denied"
  | "read-only"
  | "destroyed";

export interface DispatchError {
  readonly code: DispatchErrorCode;
  readonly message: string;
  /** Index of the offending operation, when applicable. */
  readonly opIndex?: number;
}

export type DispatchResult =
  | { readonly ok: true; readonly state: EditorState; readonly transaction: Transaction }
  | { readonly ok: false; readonly error: DispatchError };

export type ReplaceDocumentResult =
  | { readonly ok: true; readonly state: EditorState }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface EditorOptions {
  /** Initial document of any supported schema version; migrated and validated on creation. */
  readonly document?: unknown;
  readonly schema?: Schema;
  readonly plugins?: readonly PluginDefinition[];
  /** Optional: only used if the integrator wires persistence. Core never requires a backend. */
  readonly storage?: StorageAdapter;
  readonly collaboration?: CollaborationAdapter;
  readonly user?: UserInfo;
  readonly editable?: boolean;
  /** Injectable for deterministic tests and for collaboration-controlled id allocation. */
  readonly ids?: IdGenerator;
  /** Injectable clock returning ISO-8601 timestamps. */
  readonly now?: () => string;
}

/**
 * Public SDK surface. Adapters (React, Web Components) hold exactly one Editor and contain
 * no editing logic of their own.
 */
export interface HistoryController {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): boolean;
  redo(): boolean;
  clear(): void;
}

export interface Editor extends EventSource {
  readonly state: EditorState;
  readonly history: HistoryController;
  readonly editable: boolean;
  readonly commands: CommandRegistry;
  readonly plugins: PluginHost;

  /** The only write path into the document. Never throws for invalid transactions. */
  dispatch(transaction: Transaction): DispatchResult;
  /** Replaces the whole document (migrate + validate). Resets history. */
  replaceDocument(input: unknown): ReplaceDocumentResult;
  setEditable(editable: boolean): void;
  /** Deactivates plugins, disconnects collaboration, releases listeners. Idempotent. */
  destroy(): Promise<void>;
}

/** Factory implemented by the engine in Stage 2. Async because plugins and adapters may be. */
export type CreateEditor = (options?: EditorOptions) => Promise<Editor>;
