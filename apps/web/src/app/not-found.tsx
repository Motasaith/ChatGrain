import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <Logo />
      <span><Compass size={29} /></span>
      <p>404</p>
      <h1>That page is not here.</h1>
      <Link className="button button-primary" href="/dashboard"><ArrowLeft size={15} /> Return to dashboard</Link>
    </main>
  );
}
