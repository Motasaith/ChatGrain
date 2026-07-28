import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { Logo } from "@/components/logo";

export default function SignInPage() {
  return (
    <main className="auth-page">
      <Link href="/" aria-label="Back to Docent">
        <Logo />
      </Link>
      <SignIn />
    </main>
  );
}
