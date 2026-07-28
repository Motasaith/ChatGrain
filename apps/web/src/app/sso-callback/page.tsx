"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { LoaderCircle } from "lucide-react";

export default function SsoCallbackPage() {
  return (
    <main className="docent-auth-callback">
      <LoaderCircle className="spin" size={24} />
      <h1>Finishing your secure sign in...</h1>
      <p>You will return to Docent automatically.</p>
      <AuthenticateWithRedirectCallback
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        firstFactorUrl="/sign-in"
        secondFactorUrl="/sign-in"
        resetPasswordUrl="/sign-in"
        continueSignUpUrl="/sign-up"
        verifyEmailAddressUrl="/sign-up"
        verifyPhoneNumberUrl="/sign-up"
        signInProtectCheckUrl="/sign-in"
        signUpProtectCheckUrl="/sign-up"
        signInFallbackRedirectUrl="/dashboard"
        signUpFallbackRedirectUrl="/dashboard"
      />
    </main>
  );
}
