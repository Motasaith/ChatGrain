import { NewAgentForm } from "@/components/app/new-agent-form";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { crawlPageLimit } from "@/lib/usage/limits";

export default async function NewAgentPage() {
  const context = await getWorkspaceContext();
  return (
    <NewAgentForm
      crawlLimit={crawlPageLimit(context.isAdmin)}
      isAdmin={context.isAdmin}
    />
  );
}
