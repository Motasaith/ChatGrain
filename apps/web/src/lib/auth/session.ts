import "server-only";

import { AppError } from "@/lib/http/errors";
import { isAdminEmail } from "./admin-emails";

export { getAdminEmails, isAdminEmail } from "./admin-emails";

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

export async function requireAdminIdentity() {
  const identity = await getCurrentIdentity();
  if (!isAdminEmail(identity.email)) {
    throw new AppError(
      "ADMIN_REQUIRED",
      "This operation is restricted to ChatGrain administrators.",
      403,
    );
  }
  return identity;
}
