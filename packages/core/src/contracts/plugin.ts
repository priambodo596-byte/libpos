import type { SchemaExtension } from "../model/schema";
import type { Editor, EditorState } from "./editor";
import type { Transaction } from "./operations";

/** Reference to a plugin by name and semver range, e.g. `{ "convetlib-tables": "^0.1.0" }`. */
export type PluginDependencies = Readonly<Record<string, string>>;

/** Capabilities a plugin may request. The runtime hands out only what the manifest declares. */
export type Permission =
  | "document:read"
  | "document:write"
  | "selection:read"
  | "commands:register"
  | "events:subscribe"
  | "storage:read"
  | "storage:write"
  | "network"
  | "clipboard";

export interface PluginManifest {
  /** Unique, e.g. "convetlib-tables". */
  readonly name: string;
  /** Plugin's own semver version. */
  readonly version: string;
  readonly description?: string;
  /** Semver range of `CORE_API_VERSION` this plugin was built and tested against. */
  readonly engines: { readonly core: string };
  readonly permissions: readonly Permission[];
  readonly dependencies?: PluginDependencies;
}

export type PluginStatus =
  | "registered"
  | "activating"
  | "active"
  | "deactivating"
  | "inactive"
  | "failed";

export interface PluginLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/**
 * The part of the editor visible to a plugin. At runtime each member is gated by the
 * manifest's permissions; using a member without the permission yields a `permission-denied`
 * error. NOTE: this limits the API surface for cooperative plugins. It is not a sandbox
 * (ADR 0004).
 */
export type PluginEditorApi = Pick<Editor, "state" | "dispatch" | "on" | "once" | "commands">;

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly editor: PluginEditorApi;
  readonly logger: PluginLogger;
  /** Cleanup callback run on deactivate/unregister, after `deactivate()`. */
  onDispose(callback: () => void): void;
}

export type TransactionHookResult =
  | { readonly action: "allow" }
  | { readonly action: "reject"; readonly reason: string }
  | { readonly action: "replace"; readonly transaction: Transaction };

export type TransactionHook = (transaction: Transaction, state: EditorState) => TransactionHookResult;

export interface PluginDefinition {
  readonly manifest: PluginManifest;
  /** Node/mark specs added to the schema when the plugin is registered. */
  readonly schema?: SchemaExtension;
  readonly activate?: (context: PluginContext) => void | Promise<void>;
  readonly deactivate?: () => void | Promise<void>;
  /** Runs before a transaction is applied; may reject or replace it. */
  readonly beforeDispatch?: TransactionHook;
}

export interface PluginInfo {
  readonly manifest: PluginManifest;
  readonly status: PluginStatus;
  /** Present when status is "failed". */
  readonly error?: string;
}

export type PluginRegistrationErrorCode =
  | "invalid-manifest"
  | "duplicate-plugin"
  | "incompatible-core"
  | "missing-dependency"
  | "incompatible-dependency"
  | "schema-conflict"
  | "activation-failed";

export type PluginRegistrationResult =
  | { readonly ok: true; readonly info: PluginInfo }
  | { readonly ok: false; readonly code: PluginRegistrationErrorCode; readonly message: string };

export interface PluginHost {
  /** Validates, applies schema extensions, then activates. Never throws for bad plugins. */
  register(definition: PluginDefinition): Promise<PluginRegistrationResult>;
  /** Deactivates and removes the plugin and everything it registered. False if unknown. */
  unregister(name: string): Promise<boolean>;
  get(name: string): PluginInfo | undefined;
  list(): readonly PluginInfo[];
}
