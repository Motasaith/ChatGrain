"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="global-error">
          <h1>ChatGrain needs a restart.</h1>
          <p>{error.message || "The application encountered an unexpected error."}</p>
          <button onClick={() => unstable_retry()}>Try again</button>
        </main>
      </body>
    </html>
  );
}
