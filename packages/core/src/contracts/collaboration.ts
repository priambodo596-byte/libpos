import type { Selection, Transaction } from "./operations";
import type { Unsubscribe } from "./events";

export interface UserInfo {
  readonly id: string;
  readonly name?: string;
  /** CSS color used for remote cursors. */
  readonly color?: string;
}

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface PresenceState {
  readonly user: UserInfo;
  readonly selection?: Selection | null;
}

export interface CollabSessionInit {
  readonly documentId: string;
  readonly user: UserInfo;
  /** Version of the local document when connecting. */
  readonly localVersion: number;
}

export interface RemoteChange {
  /**
   * Transactions already positioned so they can be applied to the current local document.
   * Who orders/rebases concurrent changes (server, OT, CRDT) is the integrator's choice (ADR 0005).
   */
  readonly transactions: readonly Transaction[];
  readonly remoteVersion: number;
}

export interface CollabConnection {
  readonly status: ConnectionStatus;
  /** Queue a locally applied transaction for delivery to other participants. */
  sendLocal(transaction: Transaction): void;
  onRemote(handler: (change: RemoteChange) => void): Unsubscribe;
  onStatus(handler: (status: ConnectionStatus) => void): Unsubscribe;
  setPresence(presence: PresenceState): void;
  onPresence(handler: (peers: readonly PresenceState[]) => void): Unsubscribe;
  disconnect(): Promise<void>;
}

/** Bridge to a backend owned by the library user. Nothing in this repo is a required server. */
export interface CollaborationAdapter {
  connect(init: CollabSessionInit): Promise<CollabConnection>;
}
