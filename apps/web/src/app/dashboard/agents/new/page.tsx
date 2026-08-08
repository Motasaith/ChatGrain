import { NewAgentForm } from "@/components/app/new-agent-form";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { crawlPageLimit } from "@/lib/usage/limits";

/**
 * The homepage hero posts its URL field here. Clerk may bounce a signed-out
 * visitor through sign-in first, but the query survives the round trip, so the
 * address they typed is prefilled rather than silently thrown away.
 */
export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  const [context, query] = await Promise.all([
    getWorkspaceContext(),
    searchParams,
  ]);
  const requested = Array.isArray(query.url) ? query.url[0] : query.url;
  return (
    <NewAgentForm
      crawlLimit={crawlPageLimit(context.isAdmin)}
      initialUrl={requested ?? ""}
      isAdmin={context.isAdmin}
    />
  );
}
