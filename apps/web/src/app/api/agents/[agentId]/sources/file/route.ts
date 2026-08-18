import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/agents/access";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { rateLimit } from "@/lib/http/rate-limit";
import { recordAudit } from "@/lib/observability/audit";
import { uploadKindFor } from "@/lib/sources/upload-kinds";
import { stageUpload } from "@/lib/sources/upload-store";
import { fileUploadLimit, formatByteLimit } from "@/lib/usage/limits";

/** One request may carry a batch, but not an unbounded one. */
const MAX_FILES_PER_REQUEST = 25;

type RouteContext = { params: Promise<{ agentId: string }> };

/**
 * Accepts training files and queues them.
 *
 * Parsing and embedding used to happen here, inside the request, which is why
 * uploads were capped at a few megabytes: the work holds the connection open
 * for as long as it takes and dies on any proxy timeout, with no progress and
 * no way to stop. The bytes are staged instead and a job is queued per file, so
 * the response returns immediately and the worker reports progress, records an
 * outcome per file, and can be stopped.
 */
export async function POST(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await context.params;
    const { context: workspace } = await requireAgent(agentId);
    rateLimit(`file:${agentId}`, 20, 60_000);

    const maximumBytes = fileUploadLimit(workspace.isAdmin);
    const limitLabel = formatByteLimit(maximumBytes);
    const form = await request.formData();
    // "file" is what the single-upload client sent; "files" is the batch form.
    const candidates = [...form.getAll("files"), ...form.getAll("file")].filter(
      (value): value is File => value instanceof File,
    );
    if (!candidates.length) {
      throw new AppError("FILE_REQUIRED", "Choose a file to upload.", 422);
    }
    if (candidates.length > MAX_FILES_PER_REQUEST) {
      throw new AppError(
        "TOO_MANY_FILES",
        `Upload up to ${MAX_FILES_PER_REQUEST} files at a time.`,
        422,
      );
    }

    // Everything is validated before anything is stored, so a bad file at the
    // end of a batch cannot leave the earlier ones half-committed.
    const planned = candidates.map((file) => {
      const kind = uploadKindFor(file.name);
      if (!kind) {
        throw new AppError(
          "UNSUPPORTED_FILE",
          `${file.name}: supported files are PDF, Excel, CSV, TXT, Markdown, JSON, and HTML.`,
          415,
        );
      }
      if (maximumBytes !== null && file.size > maximumBytes) {
        throw new AppError(
          "FILE_TOO_LARGE",
          `${file.name} is larger than the ${limitLabel} limit.`,
          413,
        );
      }
      if (file.size < 1) {
        throw new AppError("FILE_EMPTY", `${file.name} is empty.`, 422);
      }
      return { file, kind };
    });

    const batchId = crypto.randomUUID();
    const queued: Array<{ jobId: string; sourceId: string; name: string }> = [];

    for (const { file, kind } of planned) {
      const staged = await stageUpload(file, kind);
      const created = await db.transaction(async (tx) => {
        // Re-uploading the same name updates that source rather than adding a
        // second one. The caller has already been warned by the preflight
        // endpoint, and the worker keeps the old documents searchable until
        // the replacements are ready.
        const [existing] = await tx
          .select({ id: sources.id, metadata: sources.metadata })
          .from(sources)
          .where(
            and(
              eq(sources.agentId, agentId),
              eq(sources.type, "file"),
              eq(sources.name, staged.fileName),
            ),
          )
          .limit(1);
        const values = {
          status: "pending" as const,
          errorCode: null,
          errorMessage: null,
          metadata: { upload: staged },
          updatedAt: new Date(),
        };
        const [source] = existing
          ? await tx
              .update(sources)
              .set(values)
              .where(eq(sources.id, existing.id))
              .returning()
          : await tx
              .insert(sources)
              .values({
                agentId,
                type: "file",
                name: staged.fileName,
                pageLimit: 1,
                ...values,
              })
              .returning();
        const [job] = await tx
          .insert(crawlJobs)
          .values({ sourceId: source.id, batchId })
          .returning();
        return { source, job };
      });
      queued.push({
        jobId: created.job.id,
        sourceId: created.source.id,
        name: staged.fileName,
      });
    }

    await db
      .update(agents)
      .set({ status: "training", updatedAt: new Date() })
      .where(eq(agents.id, agentId));
    await recordAudit({
      workspaceId: workspace.workspaceId,
      actorUserId: workspace.userId,
      actorEmail: workspace.email,
      action: "source.training_queued",
      targetType: "agent",
      targetId: agentId,
      message: `Queued ${queued.length} file${queued.length === 1 ? "" : "s"} for indexing.`,
    });

    return NextResponse.json(
      { data: { batchId, jobs: queued }, requestId },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
