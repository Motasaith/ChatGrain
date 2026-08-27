import { and, eq, sql } from "drizzle-orm";
import { ShieldQuestion } from "lucide-react";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { GRANT_TTL_HOURS } from "@/lib/auth/impersonation-grant";
import { db } from "@/lib/db/client";
import { impersonationGrants } from "@/lib/db/schema";
import { PermissionDecision } from "@/components/app/permission-decision";

type PageProps = { params: Promise<{ token: string }> };

/**
 * Where a customer answers "may support change my account?".
 *
 * Inside the dashboard rather than on a public page reached by the link alone,
 * because the link arrives by email and email gets forwarded. Being signed in
 * as an owner of the workspace is what proves who is answering; the token only
 * says which request is being answered.
 *
 * The page is written for somebody who did not ask for it and may not know what
 * it is. So it leads with what support can already do without permission -
 * which is the reassuring half, and the half that makes the request legible as
 * a limited thing rather than an alarming one.
 */
export default async function PermissionPage({ params }: PageProps) {
  const { token } = await params;
  const workspace = await getWorkspaceContext();

  const [grant] = await db
    .select({
      adminEmail: impersonationGrants.adminEmail,
      reason: impersonationGrants.reason,
      status: impersonationGrants.status,
      requestedAt: impersonationGrants.requestedAt,
      // Decided by the database rather than by comparing against `Date.now()`
      // here: a server component has to be pure, and "has this expired" read
      // during render is the definition of a value that is not.
      expired: sql<boolean>`${impersonationGrants.expiresAt} < now()`,
    })
    .from(impersonationGrants)
    .where(
      and(
        eq(impersonationGrants.token, token),
        eq(impersonationGrants.workspaceId, workspace.workspaceId),
      ),
    )
    .limit(1);

  if (!grant) {
    return (
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Permissions</span>
          <h1>That request could not be found</h1>
          <p>
            It may have been withdrawn, or it may belong to a different
            workspace than the one you are signed in to.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Permissions</span>
          <h1>A support request needs your answer</h1>
          <p>
            Nothing in your workspace has been changed. This decides whether it
            can be.
          </p>
        </div>
        <ShieldQuestion size={18} />
      </div>

      <section className="app-card permission-card">
        <dl className="permission-facts">
          <div>
            <dt>Who is asking</dt>
            <dd>{grant.adminEmail}</dd>
          </div>
          <div>
            <dt>Why</dt>
            <dd>{grant.reason}</dd>
          </div>
          <div>
            <dt>Asked</dt>
            <dd>{grant.requestedAt.toUTCString()}</dd>
          </div>
          <div>
            <dt>If you allow it</dt>
            <dd>
              They can change your agents, prompts, sources and settings for{" "}
              {GRANT_TTL_HOURS} hours. Everything they do is recorded in your
              activity, and you can withdraw it at any time.
            </dd>
          </div>
        </dl>

        {/* The reassuring half, and the reason this page is not alarming: the
            things support can already do are the things that need no
            permission, and saying so is what makes the request legible. */}
        <div className="permission-context">
          <h3>What support can already do without asking</h3>
          <ul>
            <li>See your dashboard exactly as you see it, and change nothing.</li>
            <li>
              Talk to your agent in a sandbox to reproduce a problem. Those
              conversations are thrown away and never appear in your activity.
            </li>
            <li>Stop a crawl that is stuck, and start one again.</li>
          </ul>
          <p>
            What they cannot do without this is alter anything you own — your
            agent&apos;s behaviour, its prompt, your sources, or your settings.
          </p>
        </div>

        <PermissionDecision
          adminEmail={grant.adminEmail}
          expired={grant.expired}
          isOwner={workspace.role === "owner"}
          status={grant.status}
          token={token}
        />
      </section>
    </>
  );
}
