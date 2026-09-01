import "server-only";

import { AppError } from "@/lib/http/errors";
import { platformRoleFor } from "./roles";

export { getAdminEmails, isAdminEmail } from "./admin-emails";
export {
  isPlatformAdmin,
  isSuperAdmin,
  platformRoleFor,
  roleIsFixedByEnvironment,
  type PlatformRole,
} from "./roles";

export type AuthIdentity = {
  externalId: string;
  email: string;
  name: string;
  avatarUrl?: string;
};

export async function getCurrentIdentity(): Promise<AuthIdentity> {
  if (process.env.AUTH_PROVIDER === "clerk") {
    const { auth, currentUser } = await import("@clerk/nextjs/server");
    const authentication = await auth();
    if (!authentication.userId) {
      throw new AppError(
        "AUTHENTICATION_REQUIRED",
        "Sign in to continue.",
        401,
      );
    }

    const user = await currentUser();
    if (!user) {
      throw new AppError(
        "AUTHENTICATION_REQUIRED",
        "Your signed-in user could not be loaded.",
        401,
      );
    }
    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress;
    if (!email) {
      throw new AppError(
        "EMAIL_REQUIRED",
        "A verified email address is required to use ChatGrain.",
        403,
      );
    }
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
      user.username ||
      email.split("@")[0];

    return {
      externalId: user.id,
      email: email.toLowerCase(),
      name,
      avatarUrl: user.imageUrl,
    };
  }

  return {
    externalId: process.env.DEV_USER_ID ?? "dev_local_owner",
    email: process.env.DEV_USER_EMAIL ?? "owner@docent.local",
    name: process.env.DEV_USER_NAME ?? "Local Owner",
  };
}

/**
 * The caller, if they may operate this installation.
 *
 * Resolves through `platformRoleFor`, which consults `ADMIN_EMAILS` first and
 * the database second - so an address granted from the dashboard works without
 * a deploy, and an address in the environment works without a database.
 */
export async function requireAdminIdentity() {
  const identity = await getCurrentIdentity();
  const role = await platformRoleFor(identity.email);
  if (role === "member") {
    throw new AppError(
      "ADMIN_REQUIRED",
      "This operation is restricted to ChatGrain administrators.",
      403,
    );
  }
  return { ...identity, role };
}

/**
 * The caller, if they may change other people's roles.
 *
 * Separate from being an administrator, because the two are different powers.
 * An administrator can already do a great deal inside customer accounts; being
 * able to hand that out to somebody else is the one that decides who else can,
 * and it should not come free with the first.
 */
export async function requireSuperAdminIdentity() {
  const identity = await requireAdminIdentity();
  if (identity.role !== "superadmin") {
    throw new AppError(
      "SUPERADMIN_REQUIRED",
      "Only a super administrator can change roles.",
      403,
    );
  }
  return identity;
}
