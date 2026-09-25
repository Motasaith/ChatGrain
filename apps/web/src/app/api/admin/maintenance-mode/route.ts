import { NextResponse } from "next/server";
import { z } from "zod";
import { setMaintenanceState } from "@/lib/admin/maintenance-mode";
import { requireAdminIdentity } from "@/lib/auth/session";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { errorResponse, readJson } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";

const inputSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(300).optional(),
});

/** Turns maintenance mode on or off. Recorded, because it locks customers out. */
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const [context, input] = await Promise.all([
      getWorkspaceContext(),
      readJson(request).then((value) => inputSchema.parse(value)),
    ]);
    await setMaintenanceState({ ...input, by: identity.email });
    await recordAudit({
      actorUserId: context.userId,
      actorEmail: identity.email,
      action: input.enabled ? "admin.maintenance_on" : "admin.maintenance_off",
      targetType: "system",
      message: input.enabled
        ? "Turned maintenance mode on. Customers see a holding page."
        : "Turned maintenance mode off. The dashboard is open again.",
      metadata: input.message ? { message: input.message } : {},
      requestId,
    });
    return NextResponse.json({ data: { enabled: input.enabled }, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
