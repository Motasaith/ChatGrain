import "server-only";

export type AuthIdentity = {
  externalId: string;
  email: string;
  name: string;
  avatarUrl?: string;
};

/**
 * Authentication adapter boundary.
 *
 * Local development intentionally has no hosted dependency. The Clerk adapter
 * will implement this same function when AUTH_PROVIDER=clerk is enabled.
 */
export async function getCurrentIdentity(): Promise<AuthIdentity> {
  if (process.env.AUTH_PROVIDER === "clerk") {
    throw new Error(
      "AUTH_PROVIDER=clerk was selected, but the Clerk adapter has not been installed yet.",
    );
  }

  return {
    externalId: process.env.DEV_USER_ID ?? "dev_local_owner",
    email: process.env.DEV_USER_EMAIL ?? "owner@docent.local",
    name: process.env.DEV_USER_NAME ?? "Local Owner",
  };
}
