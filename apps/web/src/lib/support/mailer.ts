import "server-only";
import { logger } from "@/lib/observability/logger";

/**
 * Outbound email for ticket notifications.
 *
 * Nothing is configured yet, so the default path is a no-op that says so
 * loudly in the logs. A missing API key must never fail the request that
 * triggered it: the ticket reply itself has already been saved, and losing it
 * because a notification could not be sent would be a far worse outcome than a
 * visitor not getting an email.
 *
 * Two providers, both usable without a paid service:
 *
 *   SUPPORT_EMAIL_PROVIDER=smtp    SMTP_URL=smtp://user:pass@host:587
 *   SUPPORT_EMAIL_PROVIDER=resend  RESEND_API_KEY=...
 *
 * plus SUPPORT_EMAIL_FROM. SMTP works against anything that speaks the
 * protocol - a self-hosted Postfix, a docker-mailserver, or a free relay -
 * so nothing here ties the install to a vendor.
 */

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
};

export function mailerConfigured() {
  const provider = process.env.SUPPORT_EMAIL_PROVIDER?.trim().toLowerCase();
  if (!process.env.SUPPORT_EMAIL_FROM?.trim()) return false;
  if (provider === "resend") return !!process.env.RESEND_API_KEY?.trim();
  if (provider === "smtp") return !!process.env.SMTP_URL?.trim();
  return false;
}

/**
 * Sends through any SMTP server.
 *
 * The transport is created per send rather than cached: notifications are
 * infrequent, and a long-lived pooled connection would be one more thing to
 * fail silently after the mail server restarts.
 */
async function sendViaSmtp(email: OutboundEmail) {
  const { createTransport } = await import("nodemailer");
  const transport = createTransport(process.env.SMTP_URL?.trim() ?? "");
  try {
    await transport.sendMail({
      from: process.env.SUPPORT_EMAIL_FROM?.trim(),
      to: email.to,
      subject: email.subject,
      text: email.text,
      ...(email.replyTo ? { replyTo: email.replyTo } : {}),
    });
  } finally {
    transport.close();
  }
}

async function sendViaResend(email: OutboundEmail) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY?.trim()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.SUPPORT_EMAIL_FROM?.trim(),
      to: [email.to],
      subject: email.subject,
      text: email.text,
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Resend returned HTTP ${response.status}: ${await response.text()}`,
    );
  }
}

/**
 * Sends a notification, reporting whether it went out.
 *
 * Never throws. Callers use the boolean to decide whether to record the
 * notification as delivered, so an unconfigured install keeps retrying later
 * instead of silently marking everything notified.
 */
export async function sendSupportEmail(email: OutboundEmail): Promise<boolean> {
  if (!mailerConfigured()) {
    logger.info(
      { to: email.to.replace(/(.).*(@.*)/, "$1***$2"), subject: email.subject },
      "Support email skipped: no mail provider configured",
    );
    return false;
  }
  const provider = process.env.SUPPORT_EMAIL_PROVIDER?.trim().toLowerCase();
  try {
    if (provider === "resend") {
      await sendViaResend(email);
      return true;
    }
    if (provider === "smtp") {
      await sendViaSmtp(email);
      return true;
    }
    logger.warn({ provider }, "Unknown support email provider");
    return false;
  } catch (error) {
    logger.error({ error }, "Support email failed to send");
    return false;
  }
}
