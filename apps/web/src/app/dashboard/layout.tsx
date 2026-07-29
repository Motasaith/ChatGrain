import type { Metadata } from "next";
import { connection } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { AppShell } from "@/components/app/app-shell";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, conversations } from "@/lib/db/schema";

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
  const [handoffs] = await db
    .select({ count: count(conversations.id) })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(
      and(
        eq(agents.workspaceId, context.workspaceId),
        eq(conversations.status, "escalated"),
      ),
    );
  return (
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
  );
}
