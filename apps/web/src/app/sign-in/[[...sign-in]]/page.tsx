import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { CustomSignIn } from "@/components/auth/custom-sign-in";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Docent workspace.",
};

export default function SignInPage() {
  return (
    <AuthShell mode="sign-in">
      <Suspense fallback={<div className="docent-auth-loading">Loading…</div>}>
        <CustomSignIn />
      </Suspense>
    </AuthShell>
  );
}
