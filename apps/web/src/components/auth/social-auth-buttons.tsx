"use client";

import { LoaderCircle } from "lucide-react";
import type { SocialStrategy } from "./auth-helpers";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M21.35 12.21c0-.74-.07-1.46-.2-2.14H12v4.05h5.23a4.47 4.47 0 0 1-1.94 2.93v2.63h3.14c1.84-1.7 2.92-4.2 2.92-7.47Z"
      />
      <path
        fill="#34A853"
        d="M12 21.7c2.62 0 4.82-.87 6.43-2.36l-3.14-2.63c-.87.58-1.98.93-3.29.93-2.53 0-4.68-1.71-5.45-4.01H3.31v2.71A9.7 9.7 0 0 0 12 21.7Z"
      />
      <path
        fill="#FBBC05"
        d="M6.55 13.63A5.83 5.83 0 0 1 6.24 12c0-.57.1-1.12.31-1.63V7.66H3.31A9.72 9.72 0 0 0 2.3 12c0 1.56.37 3.04 1.01 4.34l3.24-2.71Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.36c1.43 0 2.71.49 3.72 1.45l2.79-2.79A9.35 9.35 0 0 0 12 2.3a9.7 9.7 0 0 0-8.69 5.36l3.24 2.71c.77-2.3 2.92-4.01 5.45-4.01Z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.58 2 12.24c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-1.05-.01-1.9-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.33 9.33 0 0 1 12 7c.85 0 1.7.12 2.5.35 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.06.36.32.68.95.68 1.92 0 1.39-.01 2.5-.01 2.84 0 .27.18.59.69.49A10.24 10.24 0 0 0 22 12.24C22 6.58 17.52 2 12 2Z"
      />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="#0A66C2"
        d="M19.67 3H4.33A1.33 1.33 0 0 0 3 4.33v15.34A1.33 1.33 0 0 0 4.33 21h15.34A1.33 1.33 0 0 0 21 19.67V4.33A1.33 1.33 0 0 0 19.67 3ZM8.34 18.33H5.66V9.7h2.68v8.63ZM7 8.52a1.55 1.55 0 1 1 0-3.1 1.55 1.55 0 0 1 0 3.1Zm11.33 9.81h-2.67v-4.2c0-1-.02-2.29-1.4-2.29-1.4 0-1.61 1.09-1.61 2.22v4.27H9.98V9.7h2.56v1.18h.04a2.81 2.81 0 0 1 2.53-1.39c2.71 0 3.22 1.79 3.22 4.11v4.73Z"
      />
    </svg>
  );
}

const providers: Array<{
  label: string;
  strategy: SocialStrategy;
  icon: React.ReactNode;
}> = [
  {
    label: "Google",
    strategy: "oauth_google",
    icon: <GoogleIcon />,
  },
  {
    label: "GitHub",
    strategy: "oauth_github",
    icon: <GitHubIcon />,
  },
  {
    label: "LinkedIn",
    strategy: "oauth_linkedin_oidc",
    icon: <LinkedInIcon />,
  },
];

export function SocialAuthButtons({
  busy,
  onSelect,
}: {
  busy: SocialStrategy | null;
  onSelect: (strategy: SocialStrategy) => Promise<void>;
}) {
  return (
    <div className="docent-social-grid">
      {providers.map((provider) => (
        <button
          type="button"
          key={provider.strategy}
          onClick={() => onSelect(provider.strategy)}
          disabled={Boolean(busy)}
          aria-label={`Continue with ${provider.label}`}
        >
          {busy === provider.strategy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            provider.icon
          )}
          <span>{provider.label}</span>
        </button>
      ))}
    </div>
  );
}
