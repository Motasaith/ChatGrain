"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Globe2,
  LoaderCircle,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

type CreateResponse = {
  data?: {
    agent: { id: string };
    job: { id: string } | null;
  };
  error?: { message?: string };
};

export function NewAgentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [pageLimit, setPageLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          websiteUrl: url || undefined,
          pageLimit,
        }),
      });
      const payload = (await response.json()) as CreateResponse;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || "Could not create the agent.");
      }
      const jobQuery = payload.data.job
        ? `?job=${payload.data.job.id}`
        : "";
      router.push(`/dashboard/agents/${payload.data.agent.id}${jobQuery}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="create-agent-layout">
      <section className="create-agent-form">
        <Link href="/dashboard/agents" className="quiet-back-link">
          <ArrowLeft size={14} /> Agents
        </Link>
        <span className="page-eyebrow">New agent</span>
        <h1>Turn your website into a reliable support agent.</h1>
        <p className="create-lead">
          Add one URL. Docent discovers useful pages, removes navigation noise,
          detects your brand, and builds a cited knowledge index.
        </p>

        <form onSubmit={submit}>
          <label className="field">
            <span>Agent name</span>
            <input
              autoFocus
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme support"
              required
              value={name}
            />
          </label>
          <label className="field">
            <span>Website URL</span>
            <div className="field-with-icon">
              <Globe2 size={17} />
              <input
                inputMode="url"
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://docs.example.com"
                type="url"
                value={url}
              />
            </div>
            <small>You can create an empty agent and add sources later.</small>
          </label>
          <label className="field">
            <span>Maximum pages</span>
            <select
              onChange={(event) => setPageLimit(Number(event.target.value))}
              value={pageLimit}
            >
              <option value={25}>25 pages</option>
              <option value={50}>50 pages</option>
              <option value={100}>100 pages</option>
              <option value={250}>250 pages</option>
              <option value={500}>500 pages</option>
            </select>
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="app-primary-button create-submit" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="spin" size={16} /> Creating agent
              </>
            ) : (
              <>
                Create and train <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
      </section>

      <aside className="create-agent-aside">
        <div className="crawl-preview">
          <div className="crawl-preview-top">
            <span><ScanSearch size={14} /> Automatic setup</span>
            <i>Live</i>
          </div>
          {[
            ["Discover", "Sitemap, links, and robots.txt"],
            ["Extract", "Readable content and metadata"],
            ["Index", "Hybrid semantic and keyword search"],
            ["Style", "Logo, icon, and primary colors"],
          ].map(([title, detail], index) => (
            <div className="crawl-preview-row" key={title}>
              <span>{index + 1}</span>
              <div><b>{title}</b><small>{detail}</small></div>
              <Check size={14} />
            </div>
          ))}
        </div>
        <div className="reliability-note">
          <ShieldCheck size={20} />
          <div>
            <b>Grounded by default</b>
            <p>
              Answers below the confidence threshold fall back safely instead
              of inventing details.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
