import type { Transaction } from "./operations";
import type { EditorState } from "./editor";
import type { Unsubscribe } from "./events";

export type CommandId = string;

export interface CommandContext {
  readonly state: EditorState;
}

/**
 * A command never mutates state. It inspects the state and either returns a transaction to
 * dispatch, `ok: true` with no transaction (nothing to do), or a refusal reason.
 */
export type CommandOutcome =
  | { readonly ok: true; readonly transaction?: Transaction }
  | { readonly ok: false; readonly reason: string };

export interface CommandSpec<Args = unknown> {
  /** Namespaced id, e.g. "text.toggleBold" or "table.insert". Must be unique per editor. */
  readonly id: CommandId;
  readonly title?: string;
  run(context: CommandContext, args: Args): CommandOutcome;
  /** Cheap check used by UI to enable/disable controls. Defaults to "always runnable". */
  canRun?(context: CommandContext, args: Args): boolean;
}

export interface CommandInfo {
  readonly id: CommandId;
  readonly title?: string;
}

export type CommandResult =
  | { readonly ok: true; /** True when a transaction was produced and applied. */ readonly dispatched: boolean }
  | { readonly ok: false; readonly reason: string };

export interface CommandRegistry {
  /** Fails if the id is already registered. The returned function unregisters the command. */
  register<Args = unknown>(spec: CommandSpec<Args>): Unsubscribe;
  has(id: CommandId): boolean;
  list(): readonly CommandInfo[];
  can(id: CommandId, args?: unknown): boolean;
  execute(id: CommandId, args?: unknown): CommandResult;
}
