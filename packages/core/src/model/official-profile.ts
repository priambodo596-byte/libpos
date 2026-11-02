import type { PageSetup } from "./types";

/** Shared typography defaults used by official business-document exports. */
export interface DocumentStyleProfile {
  fontFamily: string;
  fontSizePt: number;
  paragraphLineSpacing: number;
  paragraphSpacingAfterPt: number;
  headingSizesPt: readonly [number, number, number];
  page: PageSetup;
}

/**
 * Convetlib's built-in official-document baseline: A4, 30 mm left margin,
 * 20 mm on the other sides, Times New Roman 12 pt, and 1.15 line spacing.
 * Organizations can pass a partial profile to either exporter to match their
 * own controlled document standard.
 */
export const OFFICIAL_DOCUMENT_PROFILE: DocumentStyleProfile = Object.freeze({
  fontFamily: "Times New Roman",
  fontSizePt: 12,
  paragraphLineSpacing: 1.15,
  paragraphSpacingAfterPt: 0,
  headingSizesPt: [16, 14, 12] as const,
  page: {
    size: { width: 11906, height: 16838 },
    orientation: "portrait" as const,
    margins: { top: 1134, right: 1134, bottom: 1134, left: 1701, header: 567, footer: 567 },
  },
});

export function officialPageSetup(): PageSetup {
  return pageSetupForOrientation(OFFICIAL_DOCUMENT_PROFILE.page, "portrait");
}

/** Applies a page profile while retaining a section's portrait/landscape choice. */
export function pageSetupForOrientation(page: PageSetup, orientation: PageSetup["orientation"]): PageSetup {
  return {
    ...page,
    orientation,
    size: orientation === page.orientation
      ? { ...page.size }
      : { width: page.size.height, height: page.size.width },
    margins: { ...page.margins },
  };
}
