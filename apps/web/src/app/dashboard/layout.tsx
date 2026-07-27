import type { Metadata } from "next";
import { connection } from "next/server";
import { AppShell } from "@/components/app/app-shell";
import { getCurrentIdentity } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const identity = await getCurrentIdentity();
  return <AppShell identity={identity}>{children}</AppShell>;
}
