import type { DocumentJSON } from "../model/types";

export type ConversionWarningCode =
  | "unsupported-feature"
  | "lossy"
  | "approximation"
  | "missing-resource"
  | "invalid-input";

/**
 * Reported for anything a converter could not represent faithfully. Converters must prefer
 * emitting a warning over silently dropping or altering content (ADR 0005).
 */
export interface ConversionWarning {
  readonly code: ConversionWarningCode;
  readonly message: string;
  /** Source location, e.g. "word/document.xml: paragraph 12". */
  readonly location?: string;
  /** Short feature name, e.g. "wordArt", "smartArt", "footnotes". */
  readonly feature?: string;
}

export interface ConversionError {
  readonly code: "invalid-input" | "unsupported-format" | "internal";
  readonly message: string;
}

export type ImportResult =
  | { readonly ok: true; readonly document: DocumentJSON; readonly warnings: readonly ConversionWarning[] }
  | { readonly ok: false; readonly error: ConversionError };

export type ExportResult =
  | { readonly ok: true; readonly data: Uint8Array; readonly warnings: readonly ConversionWarning[] }
  | { readonly ok: false; readonly error: ConversionError };

/** Implemented by format packages (e.g. `@convetlib/docx`). */
export interface DocumentImporter<Options = unknown> {
  /** Short format id, e.g. "docx". */
  readonly format: string;
  import(data: Uint8Array, options?: Options): Promise<ImportResult>;
}

export interface DocumentExporter<Options = unknown> {
  readonly format: string;
  readonly mimeType: string;
  export(document: DocumentJSON, options?: Options): Promise<ExportResult>;
}
