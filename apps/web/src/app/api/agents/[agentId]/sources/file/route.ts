import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { requireAgent } from "@/lib/agents/access";
import { AppError, errorResponse } from "@/lib/http/errors";
import { rateLimit } from "@/lib/http/rate-limit";
import { ingestTextSource } from "@/lib/sources/ingest-text";

const MAX_FILE_BYTES = 5_000_000;
const accepted = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "text/html",
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await params;
    await requireAgent(agentId);
    rateLimit(`file:${agentId}`, 20, 60_000);
    const declaredSize = Number(request.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_FILE_BYTES + 100_000) {
      throw new AppError("FILE_TOO_LARGE", "Files are limited to 5 MB.", 413);
    }
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) {
      throw new AppError("FILE_REQUIRED", "Choose a file to upload.", 422);
    }
    if (value.size > MAX_FILE_BYTES) {
      throw new AppError("FILE_TOO_LARGE", "Files are limited to 5 MB.", 413);
    }
    if (!accepted.has(value.type)) {
      throw new AppError(
        "UNSUPPORTED_FILE",
        "Supported files are TXT, Markdown, CSV, JSON, and HTML.",
        415,
      );
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
    const result = await ingestTextSource({
      agentId,
      name: value.name.slice(0, 160),
      content,
      type: "file",
      mimeType: value.type,
    });
    return NextResponse.json({ data: result, requestId }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
