import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where attachments live.
 *
 * Local disk is the default so a clone still runs with no accounts and no
 * configuration. Setting `S3_BUCKET` switches to object storage without any
 * other change: the storage keys are identical in both backends, so a row
 * written under one is addressable under the other once the files are copied.
 *
 * Deliberately S3-generic rather than named after one vendor. Backblaze B2,
 * Cloudflare R2, Supabase Storage and AWS all speak this API, and the only
 * difference between them is the endpoint and region.
 */

function bucket() {
  return process.env.S3_BUCKET?.trim();
}

export function usingObjectStore() {
  return Boolean(bucket());
}

type S3Module = typeof import("@aws-sdk/client-s3");
let clientPromise:
  | Promise<{ s3: InstanceType<S3Module["S3Client"]>; mod: S3Module }>
  | undefined;

/**
 * Loaded on demand. The SDK is a large dependency and a deployment using local
 * disk should never pay to parse it.
 */
async function store() {
  if (!clientPromise) {
    clientPromise = import("@aws-sdk/client-s3").then((mod) => ({
      mod,
      s3: new mod.S3Client({
        region: process.env.S3_REGION?.trim() || "auto",
        endpoint: process.env.S3_ENDPOINT?.trim(),
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
        },
      }),
    }));
  }
  return clientPromise;
}

function uploadDirectory() {
  const configured = process.env.UPLOAD_DIR?.trim();
  if (configured) return path.resolve(/*turbopackIgnore: true*/ configured);
  return path.resolve(
    path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "uploads"),
  );
}

/**
 * Rejects anything that is not one of our generated keys, which is what stops
 * a crafted key from escaping the upload directory with `..`.
 */
export function assertSafeKey(storageKey: string) {
  return /^[a-f0-9-]{36}\.[a-z0-9]{2,5}$/i.test(storageKey);
}

function localPath(storageKey: string) {
  const root = uploadDirectory();
  const target = path.resolve(root, storageKey);
  // Belt and braces: the key is already validated, but a path that resolves
  // outside the root must never be read or written regardless.
  if (path.dirname(target) !== root) return undefined;
  return target;
}

export async function putObject(
  storageKey: string,
  bytes: Uint8Array,
  contentType: string,
) {
  const name = bucket();
  if (!name) {
    const target = localPath(storageKey);
    if (!target) throw new Error("Refusing to write outside the upload root.");
    await mkdir(/*turbopackIgnore: true*/ uploadDirectory(), {
      recursive: true,
    });
    // `wx` so a key collision is an error rather than a silent overwrite of
    // somebody else's attachment.
    await writeFile(/*turbopackIgnore: true*/ target, bytes, { flag: "wx" });
    return;
  }
  const { s3, mod } = await store();
  await s3.send(
    new mod.PutObjectCommand({
      Bucket: name,
      Key: storageKey,
      Body: bytes,
      ContentType: contentType,
    }),
  );
}

export async function getObject(storageKey: string) {
  const name = bucket();
  if (!name) {
    const target = localPath(storageKey);
    if (!target) return undefined;
    return readFile(/*turbopackIgnore: true*/ target).catch(() => undefined);
  }
  const { s3, mod } = await store();
  try {
    const result = await s3.send(
      new mod.GetObjectCommand({ Bucket: name, Key: storageKey }),
    );
    const body = await result.Body?.transformToByteArray();
    return body ? Buffer.from(body) : undefined;
  } catch {
    return undefined;
  }
}

export async function deleteObject(storageKey: string) {
  const name = bucket();
  if (!name) {
    const target = localPath(storageKey);
    if (target) {
      await unlink(/*turbopackIgnore: true*/ target).catch(() => undefined);
    }
    return;
  }
  const { s3, mod } = await store();
  await s3
    .send(new mod.DeleteObjectCommand({ Bucket: name, Key: storageKey }))
    .catch(() => undefined);
}
