import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { CustomSignUp } from "@/components/auth/custom-sign-up";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a Docent workspace and build your first support agent.",
};

export default function SignUpPage() {
  return (
    <AuthShell mode="sign-up">
      <Suspense fallback={<div className="docent-auth-loading">Loading…</div>}>
        <CustomSignUp />
      </Suspense>
    </AuthShell>
  );
}
