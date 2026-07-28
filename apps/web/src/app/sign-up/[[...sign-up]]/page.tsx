import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { Logo } from "@/components/logo";

export default function SignUpPage() {
  return (
    <main className="auth-page">
      <Link href="/" aria-label="Back to Docent">
        <Logo />
      </Link>
      <SignUp />
    </main>
  );
}
