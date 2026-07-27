"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard render failed", error);
  }, [error]);
  return (
    <div className="route-error">
      <span><AlertTriangle size={23} /></span>
      <h2>This screen could not be loaded.</h2>
      <p>{error.message || "An unexpected server error occurred."}</p>
      {error.digest && <code>Trace: {error.digest}</code>}
      <button className="app-primary-button" onClick={() => unstable_retry()}>
        <RotateCcw size={14} /> Try again
      </button>
    </div>
  );
}
