import type { Metadata } from "next";
import { connection } from "next/server";
import { and, count, eq, ne } from "drizzle-orm";
import { AppShell } from "@/components/app/app-shell";
import { ImpersonationBanner } from "@/components/app/impersonation-banner";
import { MaintenancePage } from "@/components/app/maintenance-page";
import { getMaintenanceState } from "@/lib/admin/maintenance-mode";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, conversations } from "@/lib/db/schema";
import { SANDBOX_CHANNEL } from "@/lib/chat/sandbox";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  if (process.env.AUTH_PROVIDER === "clerk") {
    const { auth } = await import("@clerk/nextjs/server");
    const authentication = await auth();
    if (!authentication.isAuthenticated) {
      return authentication.redirectToSignIn();
    }
  }
  const context = await getWorkspaceContext();
  // Administrators are exempt: they are the ones doing the maintenance, and
  // the switch to end it lives inside the dashboard it closes.
  if (!context.isAdmin) {
    const maintenance = await getMaintenanceState();
    if (maintenance.enabled) {
      return <MaintenancePage message={maintenance.message} />;
    }
  }
  const [handoffs] = await db
    .select({ count: count(conversations.id) })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(
      and(
        eq(agents.workspaceId, context.workspaceId),
        eq(conversations.status, "escalated"),
        ne(conversations.channel, SANDBOX_CHANNEL),
      ),
    );
  // Outside AppShell, above everything. Whose data is on screen is not a
  // detail of the dashboard; it is the first thing to know about the page, and
  // it has to survive whatever the page below decides to render.
  const acting = context.impersonating;
  return (
    <>
      {acting ? (
        <ImpersonationBanner
          mode={acting.mode}
          expiresAt={acting.expiresAt}
          workspaceName={acting.workspaceName}
        />
      ) : null}
      <AppShell
        identity={{
          name: context.name,
          email: context.email,
          isAdmin: context.isAdmin,
          workspaceName: context.workspaceName,
        }}
        clerkEnabled={process.env.AUTH_PROVIDER === "clerk"}
        pendingHandoffs={handoffs?.count ?? 0}
      >
        {children}
      </AppShell>
    </>
  );
}
