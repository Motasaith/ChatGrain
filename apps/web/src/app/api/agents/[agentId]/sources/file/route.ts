import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { requireAgent } from "@/lib/agents/access";
import { AppError, errorResponse } from "@/lib/http/errors";
import { rateLimit } from "@/lib/http/rate-limit";
import { ingestCsvSource } from "@/lib/sources/ingest-csv";
import { ingestPdfSource } from "@/lib/sources/ingest-pdf";
import { ingestSpreadsheetSource } from "@/lib/sources/ingest-spreadsheet";
import { ingestTextSource } from "@/lib/sources/ingest-text";
import {
  fileUploadLimit,
  formatByteLimit,
} from "@/lib/usage/limits";

const accepted = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "text/html",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

/** Formats read as bytes rather than text. */
const BINARY_EXTENSIONS = new Set(["pdf", "xlsx", "xlsm", "xls"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await params;
    const { context } = await requireAgent(agentId);
    rateLimit(`file:${agentId}`, 20, 60_000);
    const maximumBytes = fileUploadLimit(context.isAdmin);
    const limitLabel = formatByteLimit(maximumBytes);
    const declaredSize = Number(request.headers.get("content-length") ?? 0);
    if (
      maximumBytes !== null &&
      declaredSize > maximumBytes + 100_000
    ) {
      throw new AppError(
        "FILE_TOO_LARGE",
        `Files are limited to ${limitLabel}.`,
        413,
      );
    }
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) {
      throw new AppError("FILE_REQUIRED", "Choose a file to upload.", 422);
    }
    if (maximumBytes !== null && value.size > maximumBytes) {
      throw new AppError(
        "FILE_TOO_LARGE",
        `Files are limited to ${limitLabel}.`,
        413,
      );
    }
    const extension = value.name.toLowerCase().split(".").pop();
    const acceptedExtension = new Set([
      "txt",
      "md",
      "markdown",
      "csv",
      "json",
      "html",
      "pdf",
      "xlsx",
      "xlsm",
      "xls",
    ]);
    if (
      !accepted.has(value.type) &&
      (!extension || !acceptedExtension.has(extension))
    ) {
      throw new AppError(
        "UNSUPPORTED_FILE",
        "Supported files are PDF, Excel, CSV, TXT, Markdown, JSON, and HTML.",
        415,
      );
    }

    const name = value.name.slice(0, 160);
    // Binary formats must be handled before any text decoding: reading a PDF
    // or workbook with `.text()` mangles it into unusable bytes.
    if (extension && BINARY_EXTENSIONS.has(extension)) {
      const data = new Uint8Array(await value.arrayBuffer());
      const ingested =
        extension === "pdf"
          ? await ingestPdfSource({ agentId, name, data })
          : await ingestSpreadsheetSource({ agentId, name, data });
      if (!ingested) {
        throw new AppError(
          "FILE_HAS_NO_CONTENT",
          extension === "pdf"
            ? "No selectable text was found. Scanned PDFs need OCR before they can be indexed."
            : "The spreadsheet has no rows with readable content.",
          422,
        );
      }
      return NextResponse.json({ data: ingested, requestId }, { status: 201 });
    }

    let content = await value.text();
    if (value.type === "text/html") {
      const $ = cheerio.load(content);
      $("script,style,noscript,nav,footer").remove();
      content = $("main").text() || $("article").text() || $("body").text();
    }
    content = content.replace(/\0/g, "").trim();
    if (content.length < 80) {
      throw new AppError(
        "FILE_HAS_NO_CONTENT",
        "The file does not contain enough readable text.",
        422,
      );
    }
    const result =
      value.type === "text/csv" || value.name.toLowerCase().endsWith(".csv")
        ? await ingestCsvSource({ agentId, name, content })
        : null;
    const ingested = result ?? await ingestTextSource({
      agentId,
      name,
      content,
      type: "file",
      mimeType: value.type,
    });
    return NextResponse.json(
      { data: ingested, requestId },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
