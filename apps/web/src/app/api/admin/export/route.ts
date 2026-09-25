import {
  agentRows,
  auditRows,
  groundedRate,
  jobRows,
  logRows,
  personRows,
  qualityRows,
  sessionRows,
  waitingConversationRows,
  waitingTicketRows,
  workspaceRows,
} from "@/app/dashboard/admin/queries";
import { EXPORT_LIMIT, type AdminSearchParams } from "@/app/dashboard/admin/shared";
import { toCsv } from "@/lib/admin/csv";
import { requireAdminIdentity } from "@/lib/auth/session";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { AppError, errorResponse } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";

type Exporter = (params: AdminSearchParams) => Promise<Array<Record<string, unknown>>>;

/**
 * Each tab's list as rows for a spreadsheet.
 *
 * Every exporter calls the same function the tab renders from, with a larger
 * limit, so the file is the list on screen as filtered. Columns are chosen
 * rather than dumped: a raw row carries avatar URLs, snapshot JSON and
 * internal ids nobody opening a spreadsheet wants.
 */
const EXPORTERS: Record<string, Exporter> = {
  workspaces: async (params) =>
    (await workspaceRows(params, EXPORT_LIMIT)).map((row) => ({
      id: row.id,
      name: row.name,
      plan: row.plan,
      state: row.suspendedAt ? "suspended" : "active",
      suspendedReason: row.suspendedReason,
      members: row.memberCount,
      agents: row.agentCount,
      answers30d: row.answersLast30,
      passages30d: row.passagesLast30,
      pageLimit: row.pageLimit,
      minRefreshHours: row.minRefreshHours,
      createdAt: row.createdAt,
    })),
  agents: async (params) =>
    (await agentRows(params, EXPORT_LIMIT)).map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      workspace: row.workspaceName,
      sources: row.sourceCount,
      conversations: row.conversationCount,
      createdAt: row.createdAt,
    })),
  people: async (params) =>
    (await personRows(params, EXPORT_LIMIT)).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      platformRole: row.platformRole,
      retentionExempt: row.retentionExempt,
      workspaces: row.workspaceNames.join("; "),
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
    })),
  jobs: async (params) =>
    (await jobRows(params, EXPORT_LIMIT)).map((row) => ({
      id: row.id,
      status: row.status,
      phase: row.phase,
      workspace: row.workspaceName,
      agent: row.agentName,
      source: row.sourceName,
      rootUrl: row.rootUrl,
      progress: row.progress,
      pagesProcessed: row.pagesProcessed,
      pagesDiscovered: row.pagesDiscovered,
      attempt: row.attempt,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      updatedAt: row.updatedAt,
    })),
  sessions: async (params) =>
    (await sessionRows(params, EXPORT_LIMIT)).map((row) => ({
      id: row.id,
      workspace: row.workspaceName,
      administrator: row.adminEmail,
      status: row.status,
      reason: row.reason,
      changes: ((row.summary as { changes?: unknown[] } | null)?.changes ?? []).length,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    })),
  audit: async (params) =>
    (await auditRows(params, EXPORT_LIMIT)).map((row) => ({
      createdAt: row.createdAt,
      action: row.action,
      message: row.message,
      actor: row.actorEmail,
      targetType: row.targetType,
      targetId: row.targetId,
      workspaceId: row.workspaceId,
      ipAddress: row.ipAddress,
      requestId: row.requestId,
      metadata: row.metadata,
    })),
  logs: async (params) =>
    (await logRows(params, EXPORT_LIMIT)).map((row) => ({
      createdAt: row.createdAt,
      level: row.level,
      service: row.service,
      message: row.message,
      context: row.context,
    })),
  quality: async (params) =>
    (await qualityRows(params)).rows.map((row) => {
      const rate = groundedRate(row);
      return {
        workspaceId: row.workspaceId,
        workspace: row.workspaceName,
        answers: row.answers,
        grounded: row.grounded,
        ungrounded: row.ungrounded,
        groundedRate: rate === null ? "" : rate.toFixed(3),
        avgLatencyMs: row.avgLatencyMs,
        p95LatencyMs: row.p95LatencyMs,
        thumbsUp: row.thumbsUp,
        thumbsDown: row.thumbsDown,
      };
    }),
  waiting: async (params) =>
    params.kind === "tickets"
      ? (await waitingTicketRows(params, EXPORT_LIMIT)).map((row) => ({
          reference: row.reference,
          subject: row.subject,
          workspace: row.workspaceName,
          priority: row.priority,
          status: row.status,
          kind: row.kind,
          requesterEmail: row.requesterEmail,
          lastReplyBy: row.lastReplyBy,
          createdAt: row.createdAt,
        }))
      : (await waitingConversationRows(params, EXPORT_LIMIT)).map((row) => ({
          id: row.id,
          title: row.title,
          workspace: row.workspaceName,
          agent: row.agentName,
          visitorName: row.visitorName,
          visitorEmail: row.visitorEmail,
          lastMessageAt: row.lastMessageAt,
          createdAt: row.createdAt,
        })),
};

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const url = new URL(request.url);
    const params: AdminSearchParams = Object.fromEntries(url.searchParams.entries());
    const tab = String(params.tab ?? "");
    const exporter = EXPORTERS[tab];
    if (!exporter) {
      throw new AppError("EXPORT_UNKNOWN", `There is no export for "${tab}".`, 404);
    }
    const rows = await exporter(params);
    const context = await getWorkspaceContext();
    // Recorded, because these files carry customers' e-mail addresses and
    // leave the system the moment they are downloaded.
    await recordAudit({
      actorUserId: context.userId,
      actorEmail: identity.email,
      action: "admin.export",
      targetType: "system",
      targetId: tab,
      message: `Exported ${rows.length.toLocaleString("en")} ${tab} rows as CSV.`,
      metadata: { tab, filters: Object.fromEntries(url.searchParams.entries()), rows: rows.length },
      requestId,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(toCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="chatgrain-${tab}-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
