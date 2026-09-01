import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { isAdminEmail } from "./admin-emails";

/**
 * Who may operate this installation, and who may decide that.
 *
 * The old answer was `ADMIN_EMAILS` and nothing else, which meant promoting a
 * colleague required an SSH session, an edited file and a restart of everything
 * — and got it wrong quietly when any step was missed, because a wrong answer
 * here looks exactly like a correct one: the person simply does not see the
 * admin pages.
 *
 * Three tiers now:
 *
 * - **member** — an ordinary customer. The default, and what an unknown address
 *   resolves to.
 * - **admin** — may operate the installation: see the dashboard, stop jobs,
 *   impersonate, edit a workspace.
 * - **superadmin** — all of that, and may change other people's roles.
 *
 * ## The environment variable still wins
 *
 * Anyone in `ADMIN_EMAILS` is a superadmin, always, and no database row can
 * demote them. That is not a leftover — it is the recovery path. Roles now live
 * in a table that a bad migration, a mistaken click or a restored backup could
 * empty, and an installation whose only route back in is the interface it just
 * locked you out of is one SSH session away from being unrecoverable. The file
 * on disk is the thing that cannot be edited by a mistake in the application.
 *
 * So `ADMIN_EMAILS` becomes what it should always have been: the bootstrap and
 * the way back, not the day-to-day mechanism.
 */

export type PlatformRole = "member" | "admin" | "superadmin";

export const PLATFORM_ROLES: readonly PlatformRole[] = [
  "member",
  "admin",
  "superadmin",
];

export function isPlatformRole(value: unknown): value is PlatformRole {
  return (
    typeof value === "string" &&
    (PLATFORM_ROLES as readonly string[]).includes(value)
  );
}

/**
 * The role an address resolves to.
 *
 * Never throws. This is consulted on the path that renders every dashboard
 * page, and a database hiccup here must not take the application down for
 * everybody — it degrades to whatever the environment says, which is the
 * conservative answer and always available.
 */
export async function platformRoleFor(email: string): Promise<PlatformRole> {
  // Checked first, and without touching the database: an installation whose
  // database is unreachable must still let its owner in to find out why.
  if (isAdminEmail(email)) return "superadmin";

  try {
    const [row] = await db
      .select({ role: users.platformRole })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    return isPlatformRole(row?.role) ? row.role : "member";
  } catch {
    return "member";
  }
}

/** May operate the installation. */
export async function isPlatformAdmin(email: string) {
  return (await platformRoleFor(email)) !== "member";
}

/** May change other people's roles. */
export async function isSuperAdmin(email: string) {
  return (await platformRoleFor(email)) === "superadmin";
}

/**
 * Whether this address is fixed by the environment.
 *
 * Used to refuse a demotion that would not take effect. Writing "member" into
 * the row of somebody listed in `ADMIN_EMAILS` succeeds, changes nothing about
 * what they can do, and leaves an administrator believing they revoked access
 * they did not — which is worse than refusing.
 */
export function roleIsFixedByEnvironment(email: string) {
  return isAdminEmail(email);
}
