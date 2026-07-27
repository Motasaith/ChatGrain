import Link from "next/link";
import { MessageCircleMore } from "lucide-react";

export function Logo({
  inverse = false,
  compact = false,
}: {
  inverse?: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      href="/"
      className={`brand-logo${inverse ? " brand-logo-inverse" : ""}`}
      aria-label="Docent home"
    >
      <span className="brand-mark">
        <MessageCircleMore size={18} strokeWidth={2.3} />
      </span>
      {!compact && <span>Docent</span>}
    </Link>
  );
}
