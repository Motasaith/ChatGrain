import type { Metadata } from "next";
import { connection } from "next/server";
import { AppShell } from "@/components/app/app-shell";
import { getWorkspaceContext } from "@/lib/auth/workspace";

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
  return (
    <AppShell
      identity={{
        name: context.name,
        email: context.email,
        isAdmin: context.isAdmin,
        workspaceName: context.workspaceName,
      }}
      clerkEnabled={process.env.AUTH_PROVIDER === "clerk"}
    >
      {children}
    </AppShell>
  );
}
