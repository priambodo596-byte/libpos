import type { DispatchError, EditorState } from "./editor";
import type { PluginStatus } from "./plugin";
import type { Selection, Transaction } from "./operations";

export type Unsubscribe = () => void;

/** Every event the editor can emit. Payloads are immutable snapshots. */
export interface EditorEventMap {
  "state:change": {
    readonly previous: EditorState;
    readonly state: EditorState;
    readonly transaction: Transaction;
  };
  "selection:change": { readonly selection: Selection | null };
  "transaction:rejected": { readonly transaction: Transaction; readonly error: DispatchError };
  "plugin:status": { readonly name: string; readonly status: PluginStatus; readonly error?: string };
  /** Errors thrown by plugin code or adapters are reported here instead of crashing the editor. */
  error: { readonly source: string; readonly error: unknown };
  destroy: Record<string, never>;
}

export type EditorEventName = keyof EditorEventMap;
export type EventHandler<K extends EditorEventName> = (payload: EditorEventMap[K]) => void;

export interface EventSource {
  /** Handlers run synchronously in registration order. The returned function unsubscribes. */
  on<K extends EditorEventName>(name: K, handler: EventHandler<K>): Unsubscribe;
  once<K extends EditorEventName>(name: K, handler: EventHandler<K>): Unsubscribe;
}
