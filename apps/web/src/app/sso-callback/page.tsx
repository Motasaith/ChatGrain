"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { LoaderCircle } from "lucide-react";

export default function SsoCallbackPage() {
  return (
    <main className="docent-auth-callback">
      <LoaderCircle className="spin" size={24} />
      <h1>Finishing your secure sign in...</h1>
      <p>You will return to Docent automatically.</p>
      <AuthenticateWithRedirectCallback />
    </main>
  );
}
