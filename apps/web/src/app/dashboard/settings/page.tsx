import { WorkspaceSettings } from "@/components/app/workspace-settings";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export default async function SettingsPage() {
  const context = await getWorkspaceContext();
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, context.workspaceId)).limit(1);
  return (
    <>
      <div className="page-heading"><div><span className="page-eyebrow">Settings</span><h1>Workspace settings</h1><p>Identity, authentication, and local runtime configuration.</p></div></div>
      <WorkspaceSettings authProvider={process.env.AUTH_PROVIDER || "dev"} email={context.email} initialName={workspace.name} slug={workspace.slug} />
    </>
  );
}
