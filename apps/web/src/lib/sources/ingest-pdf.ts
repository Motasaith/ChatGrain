import { ingestSourceRecords, type SourceRecord } from "./ingest-records";

/** Pages with less text than this are covers, dividers, or scan noise. */
const MIN_PAGE_CHARACTERS = 40;

/**
 * Extracts the text layer of a PDF, one record per page.
 *
 * Page-level records keep citations meaningful - an answer can point at "page
 * 14" rather than the whole document - and stop a long PDF from collapsing
 * into a single oversized chunk.
 */
export async function extractPdfPages(data: Uint8Array) {
  // Imported lazily so the PDF engine is only loaded when a PDF is uploaded.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages.map((value) => normalizePdfText(String(value ?? "")));
}

/**
 * PDF text layers arrive with hard line breaks mid-sentence and hyphenated
 * words split across lines. Left alone those become chunk boundaries in the
 * wrong places and the embeddings degrade.
 */
export function normalizePdfText(value: string) {
  return value
    .replace(/ /g, " ")
    .replace(/-\n(\p{Ll})/gu, "$1")
    .replace(/(\p{Ll},?)\n(\p{Ll})/gu, "$1 $2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function ingestPdfSource({
  agentId,
  name,
  data,
}: {
  agentId: string;
  name: string;
  data: Uint8Array;
}) {
  const pages = await extractPdfPages(data);
  const records: SourceRecord[] = pages.flatMap((content, index) =>
    content.length >= MIN_PAGE_CHARACTERS
      ? [
          {
            title: `${name} — page ${index + 1}`,
            content,
            metadata: { page: index + 1, pageCount: pages.length },
          },
        ]
      : [],
  );

  return ingestSourceRecords({
    agentId,
    name,
    records,
    format: "pdf",
    mimeType: "application/pdf",
    metadata: { pages: pages.length, indexedPages: records.length },
  });
}
