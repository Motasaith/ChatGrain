export type SocialStrategy =
  | "oauth_google"
  | "oauth_github"
  | "oauth_linkedin_oidc";

export type MfaStrategy =
  | "email_code"
  | "phone_code"
  | "totp"
  | "backup_code";

export function errorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const value = error as { longMessage?: string; message?: string };
    return (
      value.longMessage ??
      value.message ??
      "Authentication could not be completed."
    );
  }
  return "Authentication could not be completed.";
}

export function safeRedirect(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}
