// No `server-only` marker: this is imported by the worker, which runs
// outside the Next.js runtime. See the note in chat/object-store.ts.
import { deleteObject, getObject, putObject } from "@/lib/chat/object-store";
import type { StagedUpload, UploadKind } from "./upload-kinds";

/**
 * Where an uploaded training file waits between the request that received it
 * and the worker that indexes it.
 *
 * Ingestion used to run inside the upload request, which is why it could only
 * accept small files: parsing and embedding a large document holds the
 * connection open for minutes and dies on any proxy timeout. Staging the bytes
 * lets the request return as soon as they are safely stored, and lets the work
 * happen in the worker where progress, cancellation and retries already exist.
 */

/**
 * The object store validates keys against a fixed shape, so the extension has
 * to come from a known-safe set rather than from the uploaded name. The real
 * name is carried alongside in the source row.
 */
function storageKeyFor(kind: UploadKind) {
  const extension = kind === "spreadsheet" ? "xlsx" : kind;
  return `${crypto.randomUUID()}.${extension}`;
}

export async function stageUpload(
  file: File,
  kind: UploadKind,
): Promise<StagedUpload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const storageKey = storageKeyFor(kind);
  const mimeType =
    file.type.toLowerCase().split(";")[0] || "application/octet-stream";
  await putObject(storageKey, bytes, mimeType);
  return {
    storageKey,
    fileName: file.name.slice(0, 180) || `upload.${kind}`,
    mimeType,
    sizeBytes: bytes.byteLength,
    kind,
  };
}

export async function readStagedUpload(storageKey: string) {
  return getObject(storageKey);
}

/**
 * Removing a staged file is best-effort on purpose: the indexed content is
 * already committed by the time this runs, and failing the job because a
 * temporary file survived would throw away good work.
 */
export async function discardStagedUpload(storageKey: string) {
  await deleteObject(storageKey).catch(() => undefined);
}
