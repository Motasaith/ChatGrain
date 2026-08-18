/**
 * Which parser reads which upload.
 *
 * Deliberately free of any storage or server-only import: the upload route,
 * the worker and the tests all need this mapping, and a `server-only` marker
 * here would make it unreachable from anywhere that is not a server module.
 */
export const UPLOAD_KINDS = {
  pdf: "pdf",
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  xls: "spreadsheet",
  csv: "csv",
  txt: "text",
  md: "text",
  markdown: "text",
  json: "text",
  html: "html",
} as const;

export type UploadKind = (typeof UPLOAD_KINDS)[keyof typeof UPLOAD_KINDS];

export function uploadKindFor(fileName: string): UploadKind | null {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  // A name with no dot yields the whole name here, which is never a key.
  if (extension === fileName.toLowerCase()) return null;
  return UPLOAD_KINDS[extension as keyof typeof UPLOAD_KINDS] ?? null;
}

/** What the worker needs to find and read a staged upload. */
export type StagedUpload = {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: UploadKind;
};
