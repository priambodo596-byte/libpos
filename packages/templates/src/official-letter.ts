import {
  createDocument,
  createNodeFactory,
  coreSchema,
  OFFICIAL_DOCUMENT_PROFILE,
  pageSetupForOrientation,
  type BlockNode,
  type DocumentJSON,
  type DocumentStyleProfile,
  type Inline,
  type PageSetup,
} from "@convetlib/core";

export interface CompanyBranding {
  name: string;
  logoSrc: string;
  unitName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface OfficialLetterTemplateOptions {
  id: string;
  name: string;
  company: CompanyBranding;
  profile?: Partial<Omit<DocumentStyleProfile, "page" | "headingSizesPt">> & {
    headingSizesPt?: DocumentStyleProfile["headingSizesPt"];
    page?: PageSetup;
  };
  /** Anchored, case-sensitive regular expression for the surat.nomor field. */
  numberPattern?: string;
  /** Anchored, case-sensitive regular expression for the surat.tanggal field. */
  datePattern?: string;
  /** Optional TrueType/OpenType font bytes for PDF output; DOCX records the family name from the profile. */
  fontBytes?: Uint8Array;
  now?: string;
}

export interface OfficialLetterTemplate {
  schemaVersion: 1;
  id: string;
  name: string;
  company: CompanyBranding;
  profile: DocumentStyleProfile;
  pdfFontBytes?: readonly number[];
  rules: {
    requiredFields: readonly string[];
    numberPattern: string;
    datePattern: string;
    requiredLogo: true;
    requiredLetterhead: true;
    requiredSignature: true;
  };
  document: DocumentJSON;
}

export interface OfficialTemplateIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface OfficialTemplateCheck {
  valid: boolean;
  issues: readonly OfficialTemplateIssue[];
}

export interface OfficialLetterOptions {
  /** Values supplied to exportDocx/exportPdf; required values are checked when this object is provided. */
  fieldValues?: Readonly<Record<string, string>>;
  /** Optional host check for a re-imported/embedded image when its original source string is no longer available. */
  isApprovedLogo?: (actualSource: string, expectedSource: string) => boolean;
}

export const OFFICIAL_LETTER_FIELDS = Object.freeze({
  number: "surat.nomor",
  date: "surat.tanggal",
  subject: "surat.perihal",
  recipient: "surat.tujuan",
  body: "surat.isi",
  signerName: "penandatangan.nama",
  signerTitle: "penandatangan.jabatan",
});

/** Baseline Indonesian long date, configurable per company through `datePattern`. */
export const INDONESIAN_LONG_DATE_PATTERN = "^\\d{1,2} (Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember) \\d{4}$";
/** A generic controlled-number format; companies can provide their own approved pattern. */
export const GENERIC_OFFICIAL_NUMBER_PATTERN = "^\\d{1,4}/[A-Z0-9.-]+/\\d{4}$";

function clonePage(page: PageSetup): PageSetup {
  return { ...page, size: { ...page.size }, margins: { ...page.margins } };
}

function resolveProfile(options: OfficialLetterTemplateOptions["profile"]): DocumentStyleProfile {
  const page = clonePage(options?.page ?? OFFICIAL_DOCUMENT_PROFILE.page);
  return {
    ...OFFICIAL_DOCUMENT_PROFILE,
    ...options,
    headingSizesPt: options?.headingSizesPt ?? OFFICIAL_DOCUMENT_PROFILE.headingSizesPt,
    page,
  };
}

function assertOptions(options: OfficialLetterTemplateOptions): void {
  if (!options.id.trim()) throw new TypeError("template id is required");
  if (!options.name.trim()) throw new TypeError("template name is required");
  if (!options.company.name.trim()) throw new TypeError("company.name is required");
  if (!options.company.logoSrc.trim()) throw new TypeError("company.logoSrc is required for an official letterhead");
  for (const [label, pattern] of [["numberPattern", options.numberPattern], ["datePattern", options.datePattern]] as const) {
    if (pattern !== undefined) {
      try { new RegExp(pattern); } catch { throw new TypeError(`${label} must be a valid regular expression`); }
    }
  }
}

function textParagraph(n: ReturnType<typeof createNodeFactory>, text: string, role: string, attrs: Record<string, string> = {}): BlockNode {
  return n.paragraph(text, { templateRole: role, ...attrs });
}

function fieldParagraph(n: ReturnType<typeof createNodeFactory>, label: string, key: string, role: string, attrs: Record<string, string> = {}): BlockNode {
  const content: Inline[] = [...(label ? [n.text(label)] : []), n.placeholder(key)];
  return n.paragraph(content, { templateRole: role, ...attrs });
}

/** Creates an editable official-letter document skeleton with a company letterhead and signature block. */
export function createOfficialLetterTemplate(options: OfficialLetterTemplateOptions): OfficialLetterTemplate {
  assertOptions(options);
  const profile = resolveProfile(options.profile);
  const ids = createNodeFactory;
  const n = ids();
  const company = { ...options.company };
  const textWidth = Math.max(2400, profile.page.size.width - profile.page.margins.left - profile.page.margins.right);
  const logoColumnWidth = Math.round(textWidth * 0.22);
  const companyColumnWidth = textWidth - logoColumnWidth;
  const companyHeader: BlockNode[] = [n.paragraph(company.name.toUpperCase(), { templateRole: "letterhead", align: "center" })];
  if (company.unitName) companyHeader.push(n.paragraph(company.unitName.toUpperCase(), { templateRole: "letterhead", align: "center" }));
  const contact = [company.address, company.phone, company.email, company.website].filter((value): value is string => Boolean(value?.trim()));
  if (contact.length) companyHeader.push(n.paragraph(contact.join(" · "), { templateRole: "letterheadContact", align: "center" }));
  const letterhead = n.block("table", [n.block("tableRow", [
    n.block("tableCell", [n.image(company.logoSrc, { alt: `${company.name} logo`, width: 100, height: 75, align: "center" })], { width: logoColumnWidth, verticalAlign: "center", borderTop: "0.1px solid #ffffff", borderRight: "0.1px solid #ffffff", borderBottom: "1px solid #000000", borderLeft: "0.1px solid #ffffff" }),
    n.block("tableCell", companyHeader, { width: companyColumnWidth, verticalAlign: "center", borderTop: "0.1px solid #ffffff", borderRight: "0.1px solid #ffffff", borderBottom: "1px solid #000000", borderLeft: "0.1px solid #ffffff" }),
  ])], { layout: "fixed", width: textWidth });
  const header: BlockNode[] = [letterhead];

  const content: BlockNode[] = [
    fieldParagraph(n, "Nomor: ", OFFICIAL_LETTER_FIELDS.number, "metadata"),
    fieldParagraph(n, "Tanggal: ", OFFICIAL_LETTER_FIELDS.date, "metadata"),
    fieldParagraph(n, "Perihal: ", OFFICIAL_LETTER_FIELDS.subject, "metadata"),
    n.paragraph(""),
    fieldParagraph(n, "Yth. ", OFFICIAL_LETTER_FIELDS.recipient, "body"),
    n.paragraph("Dengan hormat,"),
    n.paragraph([n.placeholder(OFFICIAL_LETTER_FIELDS.body)]),
    n.paragraph("Demikian disampaikan. Atas perhatian dan kerja samanya, kami ucapkan terima kasih."),
    n.paragraph(""),
    textParagraph(n, "Hormat kami,", "signature", { align: "right" }),
    n.paragraph(""),
    n.paragraph(""),
    fieldParagraph(n, "", OFFICIAL_LETTER_FIELDS.signerName, "signature", { align: "right" }),
    fieldParagraph(n, "", OFFICIAL_LETTER_FIELDS.signerTitle, "signature", { align: "right" }),
  ];
  const document = createDocument({
    id: `${options.id}-document`,
    title: options.name,
    language: "id-ID",
    page: profile.page,
    content,
    ...(options.now ? { now: options.now } : {}),
  });
  document.meta.custom = { officialTemplateId: options.id, documentType: "official-letter" };
  document.sections[0]!.header = header;

  return {
    schemaVersion: 1,
    id: options.id,
    name: options.name,
    company,
    profile,
    ...(options.fontBytes ? { pdfFontBytes: Array.from(options.fontBytes) } : {}),
    rules: {
      requiredFields: Object.values(OFFICIAL_LETTER_FIELDS),
      numberPattern: options.numberPattern ?? GENERIC_OFFICIAL_NUMBER_PATTERN,
      datePattern: options.datePattern ?? INDONESIAN_LONG_DATE_PATTERN,
      requiredLogo: true,
      requiredLetterhead: true,
      requiredSignature: true,
    },
    document,
  };
}

type ModelNode = { type: string; id?: string; attrs?: Record<string, unknown>; text?: string; content?: readonly ModelNode[] };

function blocksInDocument(document: DocumentJSON): ModelNode[] {
  const result: ModelNode[] = [];
  const visit = (nodes: readonly unknown[] | undefined): void => {
    for (const raw of nodes ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const node = raw as ModelNode;
      result.push(node);
      visit(node.content);
    }
  };
  for (const section of document.sections ?? []) {
    visit(section.header); visit(section.firstPageHeader); visit(section.evenPageHeader);
    visit(section.content); visit(section.footer); visit(section.firstPageFooter); visit(section.evenPageFooter);
  }
  return result;
}

function plainText(nodes: readonly ModelNode[]): string {
  return nodes.map(node => node.type === "text" ? node.text ?? "" : plainText(node.content ?? [])).join("");
}

function flattenNodes(nodes: readonly ModelNode[]): ModelNode[] {
  return nodes.flatMap(node => [node, ...flattenNodes(node.content ?? [])]);
}

function placeholderKeys(nodes: readonly ModelNode[]): Set<string> {
  const result = new Set<string>();
  for (const node of nodes) {
    if (node.type === "placeholder" && typeof node.attrs?.key === "string") result.add(node.attrs.key);
    for (const key of placeholderKeys(node.content ?? [])) result.add(key);
  }
  return result;
}

function matchesPage(actual: PageSetup, expected: PageSetup): boolean {
  return actual.orientation === expected.orientation
    && actual.size.width === expected.size.width && actual.size.height === expected.size.height
    && actual.margins.top === expected.margins.top && actual.margins.right === expected.margins.right
    && actual.margins.bottom === expected.margins.bottom && actual.margins.left === expected.margins.left
    && actual.margins.header === expected.margins.header && actual.margins.footer === expected.margins.footer;
}

/** Checks the template itself, or checks a completed letter when `fieldValues` is supplied. */
export function checkOfficialLetter(
  template: OfficialLetterTemplate,
  document: DocumentJSON = template.document,
  options: OfficialLetterOptions = {},
): OfficialTemplateCheck {
  const issues: OfficialTemplateIssue[] = [];
  const add = (code: string, path: string, message: string, severity: OfficialTemplateIssue["severity"] = "error") => issues.push({ severity, code, path, message });
  const nodes = blocksInDocument(document);
  const allKeys = placeholderKeys(nodes);
  const firstSection = document.sections?.[0];
  const headerNodes = firstSection?.header ?? [];
  const headerModel = headerNodes as unknown as ModelNode[];
  const signatureNodes = nodes.filter(node => node.attrs?.templateRole === "signature");
  const signatureKeys = placeholderKeys(signatureNodes);
  const headerText = plainText(headerModel).toLocaleLowerCase("id-ID");

  for (const issue of coreSchema.validate(document)) add(`schema-${issue.code}`, issue.path, issue.message);
  if (!firstSection) add("missing-section", "sections", "Dokumen resmi harus memiliki setidaknya satu section.");

  const logo = flattenNodes(headerModel).find(node => node.type === "image" && typeof node.attrs?.src === "string" && Boolean(node.attrs.src.trim()));
  if (template.rules.requiredLogo && !logo) add("missing-logo", "sections[0].header", "Logo perusahaan wajib ada di header surat.");
  else if (logo && typeof logo.attrs?.src === "string" && logo.attrs.src !== template.company.logoSrc) {
    const approved = options.isApprovedLogo?.(logo.attrs.src, template.company.logoSrc);
    if (approved === false) add("logo-mismatch", "sections[0].header", "Logo pada dokumen berbeda dari logo resmi yang ditetapkan template.");
    else if (approved !== true && logo.attrs.src.startsWith("data:image/")) add("logo-unverified", "sections[0].header", "Logo ada, tetapi identitas file tertanam perlu diverifikasi oleh aplikasi host.", "warning");
    else if (approved !== true) add("logo-mismatch", "sections[0].header", "Logo pada dokumen berbeda dari logo resmi yang ditetapkan template.");
  }
  if (template.rules.requiredLetterhead) {
    const requiredLetterhead = [template.company.name, template.company.unitName, template.company.address, template.company.phone, template.company.email, template.company.website]
      .filter((value): value is string => Boolean(value?.trim()));
    for (const line of requiredLetterhead) {
      if (!headerText.includes(line.toLocaleLowerCase("id-ID"))) add("missing-letterhead", "sections[0].header", `Teks kop wajib “${line}” tidak ditemukan.`);
    }
  }
  document.sections?.forEach((section, index) => {
    if (!section?.page?.orientation) return;
    const pageForOrientation = pageSetupForOrientation(template.profile.page, section.page.orientation);
    if (!matchesPage(section.page, pageForOrientation)) add("page-standard", `sections[${index}].page`, "Ukuran kertas atau margin tidak sesuai profil template resmi.");
  });

  for (const key of template.rules.requiredFields) {
    if (!allKeys.has(key)) add("missing-field-token", "sections", `Placeholder wajib {{${key}}} tidak ditemukan di dokumen.`);
  }
  if (template.rules.requiredSignature) {
    if (!signatureNodes.length) add("missing-signature-block", "sections", "Blok tanda tangan resmi tidak ditemukan.");
    for (const key of [OFFICIAL_LETTER_FIELDS.signerName, OFFICIAL_LETTER_FIELDS.signerTitle]) {
      if (!signatureKeys.has(key)) add("signature-field", "sections", `Blok tanda tangan harus memuat {{${key}}}.`);
    }
  }

  if (options.fieldValues !== undefined) {
    for (const key of template.rules.requiredFields) {
      const value = options.fieldValues[key];
      if (typeof value !== "string" || !value.trim()) add("missing-value", `fields.${key}`, `Nilai untuk ${key} wajib diisi.`);
    }
    for (const [key, pattern, label] of [
      [OFFICIAL_LETTER_FIELDS.number, template.rules.numberPattern, "nomor surat"],
      [OFFICIAL_LETTER_FIELDS.date, template.rules.datePattern, "tanggal surat"],
    ] as const) {
      const value = options.fieldValues[key];
      if (typeof value !== "string" || !value.trim()) continue;
      try {
        if (!new RegExp(pattern).test(value)) add("invalid-format", `fields.${key}`, `Format ${label} “${value}” tidak sesuai pola template.`);
      } catch {
        add("invalid-rule", `rules.${key}`, `Pola validasi untuk ${label} tidak valid.`);
      }
    }
  }

  return { valid: !issues.some(issue => issue.severity === "error"), issues };
}

/** Returns the shared options used to export a checked letter consistently through DOCX or PDF. */
export function officialExportOptions(template: OfficialLetterTemplate, fieldValues: Readonly<Record<string, string>>) {
  return { profile: template.profile, fieldValues: { ...fieldValues }, ...(template.pdfFontBytes ? { fontBytes: new Uint8Array(template.pdfFontBytes) } : {}) };
}

/** Formats a Date or ISO date string as `02 November 2026` using Indonesian month names. */
export function formatOfficialDate(value: Date | string): string {
  let date: Date;
  if (value instanceof Date) date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) date = new Date(`${value}T00:00:00.000Z`);
  else date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("A valid date is required");
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/** Returns the built-in schema-validation issues for template authors building custom document skeletons. */
export function validateOfficialTemplateDocument(document: DocumentJSON): OfficialTemplateCheck {
  const issues = coreSchema.validate(document).map(issue => ({ severity: "error" as const, code: `schema-${issue.code}`, path: issue.path, message: issue.message }));
  return { valid: issues.length === 0, issues };
}
