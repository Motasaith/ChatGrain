"use client";

import { RedirectToTasks } from "@clerk/nextjs";
import { LoaderCircle } from "lucide-react";

export default function SignInTaskPage() {
  return (
    <main className="docent-auth-callback">
      <LoaderCircle className="spin" size={24} />
      <h1>Completing your account security...</h1>
      <p>One final account step is required.</p>
      <RedirectToTasks />
    </main>
  );
}
