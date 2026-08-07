import Link from "next/link";

/**
 * ChatGrain mark: a speech bubble holding three angled grains.
 *
 * The grains double as typing dots, so it reads as a chat product at a glance
 * and as the name up close. Drawn inline rather than imported as a file so it
 * inherits `currentColor` and stays crisp at every size, including the 18px
 * navigation mark.
 */
export function ChatGrainMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5.6 3.5h12.8a3.1 3.1 0 0 1 3.1 3.1v7.9a3.1 3.1 0 0 1-3.1 3.1h-6.1l-3.9 3a.7.7 0 0 1-1.1-.6v-2.4H5.6a3.1 3.1 0 0 1-3.1-3.1V6.6a3.1 3.1 0 0 1 3.1-3.1Z"
        fill="currentColor"
      />
      {/* Painted in the mark's background colour so the grains read as
          cut-outs of the bubble rather than floating shapes. */}
      <g fill="var(--brand-mark-seed, #177e51)">
        <ellipse cx="7.6" cy="12" rx="1.25" ry="2.1" transform="rotate(-22 7.6 12)" />
        <ellipse cx="12" cy="10.6" rx="1.25" ry="2.1" transform="rotate(-22 12 10.6)" />
        <ellipse cx="16.4" cy="9.2" rx="1.25" ry="2.1" transform="rotate(-22 16.4 9.2)" />
      </g>
    </svg>
  );
}

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
      aria-label="ChatGrain home"
    >
      <span className="brand-mark">
        <ChatGrainMark />
      </span>
      {!compact && (
        <span className="brand-word">
          Chat<b>Grain</b>
        </span>
      )}
    </Link>
  );
}
