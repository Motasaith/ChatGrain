import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  LockKeyhole,
  MessageSquareText,
} from "lucide-react";
import { Logo } from "@/components/logo";

export function AuthShell({
  children,
  mode,
}: {
  children: React.ReactNode;
  mode: "sign-in" | "sign-up";
}) {
  return (
    <main className="docent-auth-page">
      <section className="docent-auth-form-side">
        <header className="docent-auth-header">
          <Logo />
          <Link href="/" className="docent-auth-back">
            <ArrowLeft size={14} />
            Back to website
          </Link>
        </header>

        <div className="docent-auth-form-wrap">{children}</div>

        <footer className="docent-auth-footer">
          <span>
            <LockKeyhole size={12} />
            Encrypted sessions
          </span>
          <span>Isolated workspaces</span>
          <Link href="/#faq">Privacy</Link>
        </footer>
      </section>

      <aside className="docent-auth-visual">
        <Image
          src="/marketing/support-workflow.png"
          alt="A support team turning company knowledge into clear customer answers"
          fill
          priority
          sizes="(max-width: 900px) 0px, 50vw"
        />
        <div className="docent-auth-visual-shade" />
        <div className="docent-auth-visual-top">
          <span>
            <MessageSquareText size={15} />
            ChatGrain workspace
          </span>
          <em>Grounded support</em>
        </div>
        <div className="docent-auth-visual-copy">
          <span className="docent-auth-proof">
            <CheckCircle2 size={14} />
            {mode === "sign-up"
              ? "Your first agent can be ready in minutes"
              : "Your agents and sources are waiting"}
          </span>
          <blockquote>
            &ldquo;Turn the knowledge your team already owns into answers
            customers can trust.&rdquo;
          </blockquote>
          <div className="docent-auth-visual-stats">
            <span>
              <b>Source-first</b>
              <small>Every answer stays grounded</small>
            </span>
            <span>
              <b>Self-hosted</b>
              <small>Your data stays under control</small>
            </span>
          </div>
        </div>
      </aside>
    </main>
  );
}
