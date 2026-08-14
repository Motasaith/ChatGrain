import "server-only";

import { AppError } from "@/lib/http/errors";
import {
  assertSafeKey,
  deleteObject,
  getObject,
  putObject,
} from "./object-store";

export type StoredAttachmentKind = "image" | "audio";

const imageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

const audioTypes = new Map([
  ["audio/webm", ".webm"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/mpeg", ".mp3"],
  ["audio/mp4", ".m4a"],
]);

function hasImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  if (mimeType === "image/webp") {
    return (
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  }
  if (mimeType === "image/gif") {
    return new TextDecoder().decode(bytes.slice(0, 3)) === "GIF";
  }
  return false;
}

function hasAudioSignature(bytes: Uint8Array, mimeType: string) {
  const text = (start: number, end: number) =>
    new TextDecoder().decode(bytes.slice(start, end));
  if (mimeType === "audio/webm") {
    return (
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    );
  }
  if (mimeType === "audio/ogg") return text(0, 4) === "OggS";
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") {
    return text(0, 4) === "RIFF" && text(8, 12) === "WAVE";
  }
  if (mimeType === "audio/mpeg") {
    return (
      text(0, 3) === "ID3" ||
      (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    );
  }
  if (mimeType === "audio/mp4") return text(4, 8) === "ftyp";
  return false;
}

function requireSafeKey(storageKey: string) {
  if (!assertSafeKey(storageKey)) {
    throw new AppError("ATTACHMENT_NOT_FOUND", "Attachment not found.", 404);
  }
  return storageKey;
}

export async function saveAttachment(
  file: File,
  kind: StoredAttachmentKind,
) {
  const allowed = kind === "image" ? imageTypes : audioTypes;
  const mimeType = file.type.toLowerCase().split(";")[0];
  const extension = allowed.get(mimeType);
  const maximumBytes = kind === "image" ? 5_000_000 : 12_000_000;
  if (!extension || file.size < 1 || file.size > maximumBytes) {
    throw new AppError(
      "ATTACHMENT_INVALID",
      kind === "image"
        ? "Use a JPEG, PNG, WebP, or GIF image up to 5 MB."
        : "Use a WebM, OGG, WAV, MP3, or M4A recording up to 12 MB.",
      422,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const valid =
    kind === "image"
      ? hasImageSignature(bytes, mimeType)
      : hasAudioSignature(bytes, mimeType);
  if (!valid) {
    throw new AppError(
      "ATTACHMENT_INVALID",
      "The attachment contents do not match its file type.",
      422,
    );
  }
  const storageKey = `${crypto.randomUUID()}${extension}`;
  await putObject(requireSafeKey(storageKey), bytes, mimeType);
  return {
    storageKey,
    mimeType,
    sizeBytes: bytes.byteLength,
    fileName: file.name.slice(0, 180) || `${kind}${extension}`,
    bytes,
  };
}

export async function readAttachment(storageKey: string) {
  const bytes = await getObject(requireSafeKey(storageKey));
  if (!bytes) {
    throw new AppError("ATTACHMENT_NOT_FOUND", "Attachment not found.", 404);
  }
  return bytes;
}

export async function removeAttachment(storageKey: string) {
  await deleteObject(requireSafeKey(storageKey));
}
