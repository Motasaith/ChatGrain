import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, chunks, documents, sources } from "@/lib/db/schema";
import { chunkText } from "@/lib/rag/chunk";
import { embedTexts } from "@/lib/rag/embeddings";

type CsvRecord = {
  title: string;
  content: string;
  canonicalUrl?: string;
  metadata: Record<string, unknown>;
};

function parseCsv(value: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}

function normalizedHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function readableCell(value: string) {
  if (!/[<>]/.test(value)) return value.replace(/\0/g, "").trim();
  const $ = cheerio.load(value);
  $("script,style,noscript").remove();
  return $.root().text().replace(/\s+/g, " ").trim();
}

function publicHttpUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    url.hash = "";
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function findColumn(headers: string[], candidates: RegExp) {
  const index = headers.findIndex((header) => candidates.test(header));
  return index >= 0 ? index : undefined;
}

export function parseCsvRecords(
  value: string,
  fileName: string,
): CsvRecord[] {
  const rows = parseCsv(value);
  if (rows.length < 2) return [];
  const labels = rows[0].map((item, index) => item.trim() || `Column ${index + 1}`);
  const headers = labels.map(normalizedHeader);
  const titleColumn = findColumn(headers, /^(?:title|name|headline|subject)$/);
  const urlColumn = findColumn(
    headers,
    /^(?:permalink|canonical_url|canonical|url|link|page_url|post_url)$/,
  );
  const dateColumn = findColumn(
    headers,
    /^(?:date|published|published_at|publish_date|date_published|created_at|post_date)$/,
  );
  const idColumn = findColumn(headers, /^(?:id|post_id|record_id)$/);

  return rows.slice(1).flatMap((row, rowIndex) => {
    const cells = labels.map((_, index) => readableCell(row[index] ?? ""));
    const canonicalUrl = publicHttpUrl(
      urlColumn === undefined ? undefined : cells[urlColumn],
    );
    const title =
      (titleColumn === undefined ? "" : cells[titleColumn]) ||
      canonicalUrl ||
      `${fileName} row ${rowIndex + 2}`;
    const content = cells
      .map((cell, index) => {
        if (!cell) return "";
        return `${labels[index]}: ${cell}`;
      })
      .filter(Boolean)
      .join("\n");
    if (content.length < 40) return [];

    const dateValue =
      dateColumn === undefined ? undefined : cells[dateColumn];
    const parsedDate = dateValue ? new Date(dateValue) : undefined;
    const idValue = idColumn === undefined ? undefined : Number(cells[idColumn]);
    const sortValue = Number.isFinite(idValue) ? idValue : rowIndex + 1;
    return [{
      title: title.slice(0, 300),
      content,
      canonicalUrl,
      metadata: {
        rowNumber: rowIndex + 2,
        sortValue,
        ...(parsedDate && !Number.isNaN(parsedDate.getTime())
          ? { publishedAt: parsedDate.toISOString() }
          : {}),
      },
    }];
  });
}

export async function ingestCsvSource({
  agentId,
  name,
  content,
}: {
  agentId: string;
  name: string;
  content: string;
}) {
  const records = parseCsvRecords(content, name);
  if (!records.length) return null;

  const preparedDocuments = records.flatMap((record) => {
    const textChunks = chunkText(record.content);
    if (!textChunks.length) return [];
    return [{
      id: crypto.randomUUID(),
      ...record,
      chunks: textChunks,
    }];
  });
  const pendingChunks = preparedDocuments.flatMap((document) =>
    document.chunks.map((chunk) => ({ document, chunk })),
  );
  const embeddedChunks: Array<{
    documentId: string;
    position: number;
    content: string;
    tokenCount: number;
    embedding: number[];
    metadata: Record<string, unknown>;
  }> = [];
  for (let offset = 0; offset < pendingChunks.length; offset += 16) {
    const batch = pendingChunks.slice(offset, offset + 16);
    const embeddings = await embedTexts(
      batch.map((item) => item.chunk.content),
    );
    embeddedChunks.push(
      ...batch.map((item, index) => ({
        documentId: item.document.id,
        position: item.chunk.position,
        content: item.chunk.content,
        tokenCount: item.chunk.tokenCount,
        embedding: embeddings[index],
        metadata: {
          title: item.document.title,
          url: item.document.canonicalUrl,
          ...item.document.metadata,
        },
      })),
    );
  }

  return db.transaction(async (tx) => {
    const [source] = await tx
      .insert(sources)
      .values({
        agentId,
        type: "file",
        status: "ready",
        name,
        pageLimit: preparedDocuments.length,
        lastSyncedAt: new Date(),
        metadata: {
          rows: records.length,
          documents: preparedDocuments.length,
          chunks: embeddedChunks.length,
          format: "csv",
        },
      })
      .returning();

    for (let offset = 0; offset < preparedDocuments.length; offset += 250) {
      await tx.insert(documents).values(
        preparedDocuments.slice(offset, offset + 250).map((document) => ({
          id: document.id,
          sourceId: source.id,
          canonicalUrl: document.canonicalUrl,
          title: document.title,
          contentHash: createHash("sha256")
            .update(document.content)
            .digest("hex"),
          mimeType: "text/csv",
          characterCount: document.content.length,
          metadata: document.metadata,
        })),
      );
    }
    for (let offset = 0; offset < embeddedChunks.length; offset += 250) {
      await tx.insert(chunks).values(
        embeddedChunks.slice(offset, offset + 250).map((chunk) => ({
          ...chunk,
          sourceId: source.id,
          agentId,
        })),
      );
    }
    await tx
      .update(agents)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(agents.id, agentId));
    return {
      source,
      documentCount: preparedDocuments.length,
      chunkCount: embeddedChunks.length,
    };
  });
}
