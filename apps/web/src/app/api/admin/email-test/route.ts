import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/lib/auth/session";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { AppError, errorResponse } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";
import { mailerConfigured, sendSupportEmail } from "@/lib/support/mailer";

/**
 * Sends a test message to the administrator who asked for it.
 *
 * Only ever to themselves: a test button that took an address would be a way
 * to send mail from this installation to anybody.
 */
export async function POST() {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    if (!mailerConfigured()) {
      throw new AppError(
        "MAILER_NOT_CONFIGURED",
        "No mail provider is configured. Set SUPPORT_EMAIL_PROVIDER, SUPPORT_EMAIL_FROM and its key first.",
        409,
      );
    }
    const context = await getWorkspaceContext();
    const sent = await sendSupportEmail({
      to: identity.email,
      subject: "ChatGrain test message",
      text: `This is a test message sent from the ChatGrain admin dashboard at ${new Date().toISOString()}.\n\nIf you can read it, outbound email from this installation works.`,
    });
    await recordAudit({
      actorUserId: context.userId,
      actorEmail: identity.email,
      action: "admin.email_test",
      targetType: "system",
      message: sent
        ? "Sent a test email to themselves."
        : "Tried to send a test email; the provider refused it.",
      requestId,
    });
    if (!sent) {
      throw new AppError(
        "MAIL_FAILED",
        "The provider refused the message. The reason is in the server log under \"Support email failed to send\".",
        502,
      );
    }
    return NextResponse.json({ data: { sentTo: identity.email }, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
