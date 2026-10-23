import type { DocumentJSON } from "../model/types";

export type StorageErrorCode = "conflict" | "not-found" | "unavailable" | "permission-denied" | "unknown";

export interface StorageError {
  readonly code: StorageErrorCode;
  readonly message: string;
  /** Present on "conflict": the revision currently stored, so the caller can reload/merge. */
  readonly currentRevision?: string;
}

/** Storage calls report failure as a value, not an exception, so conflicts are handled explicitly. */
export type StorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: StorageError };

export interface StoredDocument {
  readonly id: string;
  /**
   * Typed `unknown` on purpose: a stored document may use an older schema version. Pass it
   * through `parseDocument()` before use.
   */
  readonly document: unknown;
  /** Opaque, backend-defined revision token used for optimistic concurrency. */
  readonly revision: string;
  readonly updatedAt: string;
}

export interface SaveOptions {
  /** Save only if the stored revision still equals this. `null` means "must not exist yet". */
  readonly expectedRevision?: string | null;
}

export interface StorageListItem {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface StorageAdapter {
  load(id: string): Promise<StorageResult<StoredDocument | null>>;
  save(id: string, document: DocumentJSON, options?: SaveOptions): Promise<StorageResult<{ readonly revision: string }>>;
  delete?(id: string): Promise<StorageResult<void>>;
  list?(): Promise<StorageResult<readonly StorageListItem[]>>;
}

export interface AssetData {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly name?: string;
}

/** Optional capability for images and other binary assets. */
export interface AssetStorageAdapter {
  /** Returns the string to put in an image node's `src` attribute (URL, key, data URI...). */
  put(asset: AssetData): Promise<StorageResult<{ readonly src: string }>>;
  get?(src: string): Promise<StorageResult<AssetData | null>>;
}

export interface VersionSummary {
  readonly versionId: string;
  readonly createdAt: string;
  readonly label?: string;
  readonly authorId?: string;
}

/** Optional capability backing the version-history module (Stage 7). */
export interface VersionStorageAdapter {
  createVersion(
    documentId: string,
    snapshot: DocumentJSON,
    info?: { readonly label?: string; readonly authorId?: string },
  ): Promise<StorageResult<VersionSummary>>;
  listVersions(documentId: string): Promise<StorageResult<readonly VersionSummary[]>>;
  /** Returns `unknown` for the same reason as `StoredDocument.document`. */
  getVersion(documentId: string, versionId: string): Promise<StorageResult<unknown | null>>;
}
