"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  DatabaseZap,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

type MaintenanceAction =
  | "cleanup-preview"
  | "cleanup-run"
  | "retry-failed-jobs"
  | "sentry-test";

export function AdminControls() {
  const router = useRouter();
  const [busy, setBusy] = useState<MaintenanceAction | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run(action: MaintenanceAction) {
    if (
      action === "cleanup-run" &&
      !window.confirm(
        "Delete Docent data for non-admin accounts inactive beyond the retention period? This cannot be undone.",
      )
    ) {
      return;
    }

    setBusy(action);
    setResult(null);
    try {
      const response = await fetch("/api/admin/maintenance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Maintenance action failed.");
      }
      const data = payload.data;
      if (action.startsWith("cleanup")) {
        setResult(
          `${data.matchedUsers} inactive users matched; ${data.deletedUsers} users, ${data.deletedWorkspaces} workspaces, ${data.deletedAuditLogs} audit events, and ${data.deletedSystemLogs} system logs deleted. Preview found ${data.expiredAuditLogs + data.expiredSystemLogs} expired log entries.`,
        );
      } else if (action === "retry-failed-jobs") {
        setResult(`${data.retriedJobs} failed jobs returned to the queue.`);
      } else {
        setResult(data.message);
      }
      router.refresh();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-control-card">
      <div className="app-card-head">
        <div>
          <h2>Maintenance controls</h2>
          <p>All actions require an authenticated administrator.</p>
        </div>
        <button
          className="admin-icon-button"
          onClick={() => router.refresh()}
          type="button"
          aria-label="Refresh administration data"
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="admin-control-actions">
        <button
          type="button"
          onClick={() => run("cleanup-preview")}
          disabled={Boolean(busy)}
        >
          {busy === "cleanup-preview" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <DatabaseZap size={15} />
          )}
          Preview retention
        </button>
        <button
          type="button"
          onClick={() => run("retry-failed-jobs")}
          disabled={Boolean(busy)}
        >
          {busy === "retry-failed-jobs" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <RotateCcw size={15} />
          )}
          Retry failed jobs
        </button>
        <button
          type="button"
          onClick={() => run("sentry-test")}
          disabled={Boolean(busy)}
        >
          {busy === "sentry-test" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <RefreshCw size={15} />
          )}
          Test Sentry
        </button>
        <button
          className="danger"
          type="button"
          onClick={() => run("cleanup-run")}
          disabled={Boolean(busy)}
        >
          {busy === "cleanup-run" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Trash2 size={15} />
          )}
          Run cleanup
        </button>
      </div>
      {result ? <p className="admin-action-result">{result}</p> : null}
    </section>
  );
}
