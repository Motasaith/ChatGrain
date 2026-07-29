"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  Clipboard,
  Code2,
  ExternalLink,
  FileText,
  Globe2,
  LoaderCircle,
  MessageSquare,
  Palette,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  SlidersHorizontal,
  DatabaseZap,
  Trash2,
} from "lucide-react";
import { ChatPanel } from "@/components/chat/chat-panel";

type Agent = {
  id: string;
  name: string;
  description: string;
  status: "draft" | "training" | "ready" | "error" | "paused";
  systemPrompt: string;
  welcomeMessage: string;
  fallbackMessage: string;
  primaryColor: string;
  logoUrl: string | null;
  iconUrl: string | null;
  widgetPosition: string;
  showBranding: boolean;
  collectFeedback: boolean;
  showCitations: boolean;
  strictMode: boolean;
  allowedDomains: string[];
  modelProvider: string;
  modelName: string | null;
  temperature: number;
};

type Source = {
  id: string;
  type: string;
  name: string;
  rootUrl: string | null;
  status: string;
  pageLimit: number;
  errorMessage: string | null;
  lastSyncedAt: Date | string | null;
  documentCount: number;
};

type Job = {
  id: string;
  sourceId: string;
  status: string;
  progress: number;
  pagesDiscovered: number;
  pagesProcessed: number;
  errorMessage: string | null;
};

type PinnedAnswer = {
  id: string;
  title: string;
  questions: string[];
  answer: string;
  useCount: number;
};

const tabs = [
  ["knowledge", "Knowledge", BookOpen],
  ["playground", "Playground", MessageSquare],
  ["behavior", "Behavior", SlidersHorizontal],
  ["appearance", "Appearance", Palette],
  ["deploy", "Deploy", Code2],
] as const;

export function AgentStudio({
  initialAgent,
  initialSources,
  initialJob,
  previewToken,
  initialPinned,
  isAdmin,
  crawlLimit,
  fileLimitLabel,
}: {
  initialAgent: Agent;
  initialSources: Source[];
  initialJob?: Job | null;
  previewToken: string;
  initialPinned: PinnedAnswer[];
  isAdmin: boolean;
  crawlLimit: number;
  fileLimitLabel: string;
}) {
  const [agent, setAgent] = useState(initialAgent);
  const [sources, setSources] = useState(initialSources);
  const [job, setJob] = useState(initialJob);
  const [pinned, setPinned] = useState(initialPinned);
  const [tab, setTab] = useState<(typeof tabs)[number][0]>(
    initialAgent.status === "ready" ? "playground" : "knowledge",
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourcePageLimit, setSourcePageLimit] = useState(
    isAdmin ? crawlLimit : Math.min(100, crawlLimit),
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [workerHealthy, setWorkerHealthy] = useState<boolean | null>(null);
  const [textOpen, setTextOpen] = useState(false);
  const [textName, setTextName] = useState("");
  const [textContent, setTextContent] = useState("");
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [pinnedQuestion, setPinnedQuestion] = useState("");
  const [pinnedAnswer, setPinnedAnswer] = useState("");

  const jobId = job?.id;
  const jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || !jobStatus || !["queued", "running"].includes(jobStatus)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) return;
      const payload = await response.json() as {
        data: { job: Job; source: Source; workerHealthy: boolean };
      };
      setJob(payload.data.job);
      setWorkerHealthy(payload.data.workerHealthy);
      setSources((current) => current.map((source) =>
        source.id === payload.data.source.id
          ? { ...source, ...payload.data.source }
          : source,
      ));
      if (payload.data.job.status === "succeeded") {
        setAgent((current) => ({ ...current, status: "ready" }));
        window.clearInterval(timer);
      }
      if (payload.data.job.status === "failed") {
        setAgent((current) => ({ ...current, status: "error" }));
        window.clearInterval(timer);
      }
    }, 1800);
    return () => window.clearInterval(timer);
  }, [jobId, jobStatus]);

  async function save() {
    setSaving(true);
    setError("");
    const response = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: agent.name,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        welcomeMessage: agent.welcomeMessage,
        fallbackMessage: agent.fallbackMessage,
        primaryColor: agent.primaryColor,
        logoUrl: agent.logoUrl,
        iconUrl: agent.iconUrl,
        widgetPosition: agent.widgetPosition,
        ...(isAdmin ? { showBranding: agent.showBranding } : {}),
        collectFeedback: agent.collectFeedback,
        showCitations: agent.showCitations,
        strictMode: agent.strictMode,
        allowedDomains: agent.allowedDomains,
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
        temperature: agent.temperature,
      }),
    });
    if (response.ok) {
      setNotice("Saved");
      window.setTimeout(() => setNotice(""), 1800);
    } else {
      const payload = await response.json();
      setError(payload.error?.message || "Could not save changes.");
    }
    setSaving(false);
  }

  async function addSource(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const response = await fetch(`/api/agents/${agent.id}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "website",
        url: sourceUrl,
        pageLimit: sourcePageLimit,
      }),
    });
    const payload = await response.json();
    if (response.ok) {
      const source = { ...payload.data.source, documentCount: 0 };
      setSources((current) => [
        source,
        ...current.filter((item) => item.id !== source.id),
      ]);
      setJob(payload.data.job);
      setAgent((current) => ({ ...current, status: "training" }));
      setSourceUrl("");
    } else {
      setError(payload.error?.message || "Could not add the source.");
    }
    setSaving(false);
  }

  async function syncSource(sourceId: string) {
    setError("");
    const response = await fetch(
      `/api/agents/${agent.id}/sources/${sourceId}`,
      { method: "POST" },
    );
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error?.message || "Could not sync the source.");
      return;
    }
    setJob(payload.data);
    setAgent((current) => ({ ...current, status: "training" }));
    setSources((current) =>
      current.map((source) =>
        source.id === sourceId ? { ...source, status: "pending" } : source,
      ),
    );
  }

  async function addText(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const response = await fetch(`/api/agents/${agent.id}/sources/text`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: textName, content: textContent }),
    });
    const payload = await response.json();
    if (response.ok) {
      setSources((current) => [
        {
          ...payload.data.source,
          rootUrl: null,
          errorMessage: null,
          documentCount: payload.data.documentCount ?? 1,
        },
        ...current,
      ]);
      setAgent((current) => ({ ...current, status: "ready" }));
      setTextName("");
      setTextContent("");
      setTextOpen(false);
    } else {
      setError(payload.error?.message || "Could not add the text source.");
    }
    setSaving(false);
  }

  async function uploadFile(file: File) {
    setSaving(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    const response = await fetch(`/api/agents/${agent.id}/sources/file`, {
      method: "POST",
      body: form,
    });
    const payload = await response.json();
    if (response.ok) {
      setSources((current) => [
        {
          ...payload.data.source,
          rootUrl: null,
          errorMessage: null,
          documentCount: 1,
        },
        ...current,
      ]);
      setAgent((current) => ({ ...current, status: "ready" }));
    } else {
      setError(payload.error?.message || "Could not upload the file.");
    }
    setSaving(false);
  }

  async function addPinned(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const response = await fetch(`/api/agents/${agent.id}/pinned`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: pinnedQuestion.slice(0, 80),
        questions: pinnedQuestion
          .split(/\n/)
          .map((item) => item.trim())
          .filter(Boolean),
        answer: pinnedAnswer,
      }),
    });
    const payload = await response.json();
    if (response.ok) {
      setPinned((current) => [payload.data, ...current]);
      setPinnedQuestion("");
      setPinnedAnswer("");
      setPinnedOpen(false);
    } else {
      setError(payload.error?.message || "Could not pin the answer.");
    }
    setSaving(false);
  }

  async function removePinned(pinnedId: string) {
    const response = await fetch(
      `/api/agents/${agent.id}/pinned/${pinnedId}`,
      { method: "DELETE" },
    );
    if (response.ok) {
      setPinned((current) => current.filter((item) => item.id !== pinnedId));
    }
  }

  function patch<K extends keyof Agent>(key: K, value: Agent[K]) {
    setAgent((current) => ({ ...current, [key]: value }));
  }

  const embedCode = `<script src="${typeof window === "undefined" ? "" : window.location.origin}/embed.js" data-agent-id="${agent.id}" async></script>`;
  const jobSource = job
    ? sources.find((source) => source.id === job.sourceId)
    : undefined;
  const crawlTarget = job?.pagesDiscovered
    ? Math.min(job.pagesDiscovered, jobSource?.pageLimit ?? job.pagesDiscovered)
    : jobSource?.pageLimit;
  const processedTowardTarget =
    job && crawlTarget
      ? Math.min(job.pagesProcessed, crawlTarget)
      : (job?.pagesProcessed ?? 0);
  const visibleProgress =
    job?.status === "running" && crawlTarget
      ? Math.max(
          job.progress,
          Math.min(
            68,
            Math.round((processedTowardTarget / crawlTarget) * 68),
          ),
        )
      : (job?.progress ?? 0);

  return (
    <>
      <div className="studio-heading">
        <div className="studio-agent-identity">
          <span style={{ background: agent.primaryColor }}>
            {agent.logoUrl || agent.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={agent.logoUrl || agent.iconUrl || ""} />
            ) : <Bot size={19} />}
          </span>
          <div>
            <small>Agent</small>
            <h1>{agent.name}</h1>
          </div>
          <i className={`status-pill status-${agent.status}`}>{agent.status}</i>
        </div>
        <div className="studio-actions">
          {error && <span className="inline-error">{error}</span>}
          {notice && <span className="save-notice"><Check size={12} /> {notice}</span>}
          <Link href={`/widget/${agent.id}?token=${encodeURIComponent(previewToken)}`} target="_blank" className="app-secondary-button">
            Preview <ExternalLink size={13} />
          </Link>
          <button className="app-primary-button" disabled={saving} onClick={save}>
            {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
            Save
          </button>
        </div>
      </div>

      <nav className="studio-tabs">
        {tabs.map(([id, label, Icon]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
            type="button"
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>

      {job && ["queued", "running"].includes(job.status) && (
        <div className="training-banner">
          <span><LoaderCircle className="spin" size={17} /></span>
          <div>
            <b>
              {job.status === "queued"
                ? workerHealthy === false
                  ? "Worker is offline"
                  : "Waiting for the worker"
                : "Training your agent"}
            </b>
            <small>
              {job.status === "queued" && workerHealthy === false
                ? "Start the worker to begin discovering pages."
                : job.pagesDiscovered
                  ? `${processedTowardTarget} of ${crawlTarget} selected pages processed · ${job.pagesDiscovered.toLocaleString()} URLs discovered`
                  : "Preparing page discovery"}
            </small>
          </div>
          <div className="training-progress"><i style={{ width: `${Math.max(4, visibleProgress)}%` }} /></div>
          <strong>{visibleProgress}%</strong>
        </div>
      )}
      {job?.status === "failed" && (
        <div className="training-banner training-error">
          <AlertTriangle size={18} />
          <div><b>Training failed</b><small>{job.errorMessage || "Review the URL and worker logs, then retry."}</small></div>
        </div>
      )}

      {tab === "knowledge" && (
        <div className="studio-columns">
          <section className="settings-panel">
            <div className="panel-heading">
              <div><h2>Knowledge sources</h2><p>Everything your agent is allowed to know.</p></div>
              <span>{sources.length} connected</span>
            </div>
            <form className="inline-source-form" onSubmit={addSource}>
              <Globe2 size={17} />
              <input
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://docs.example.com"
                required
                type="url"
                value={sourceUrl}
              />
              <select
                aria-label="Maximum pages"
                onChange={(event) =>
                  setSourcePageLimit(Number(event.target.value))
                }
                value={sourcePageLimit}
              >
                <option value={100}>100 pages</option>
                <option value={Math.min(500, crawlLimit)}>
                  {Math.min(500, crawlLimit)} pages
                </option>
                {isAdmin && crawlLimit > 500 ? (
                  <option value={crawlLimit}>
                    Entire site · {crawlLimit.toLocaleString()}
                  </option>
                ) : null}
              </select>
              <button disabled={saving}><Plus size={14} /> Add website</button>
            </form>
            <div className="knowledge-tools">
              <label>
                <FileText size={13} /> Upload file
                <input
                  accept=".txt,.md,.markdown,.csv,.json,.html,text/plain,text/markdown,text/csv,application/json,text/html"
                  disabled={saving}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadFile(file);
                    event.target.value = "";
                  }}
                  type="file"
                />
              </label>
              <button onClick={() => setTextOpen((value) => !value)} type="button">
                <FileText size={13} /> Paste text
              </button>
              <button onClick={() => setPinnedOpen((value) => !value)} type="button">
                <Pin size={13} /> Pin an answer
              </button>
            </div>
            <small className="knowledge-limit-note">
              File uploads: {fileLimitLabel}.
              {isAdmin
                ? ` Full-site crawling is available up to ${crawlLimit.toLocaleString()} pages.`
                : ""}
            </small>
            {textOpen && (
              <form className="knowledge-inline-editor" onSubmit={addText}>
                <label className="field"><span>Source name</span><input onChange={(event) => setTextName(event.target.value)} placeholder="Product overview" required value={textName} /></label>
                <label className="field"><span>Content</span><textarea minLength={80} onChange={(event) => setTextContent(event.target.value)} placeholder="Paste policies, documentation, or any verified text…" required rows={6} value={textContent} /></label>
                <div><button className="app-secondary-button" onClick={() => setTextOpen(false)} type="button">Cancel</button><button className="app-primary-button" disabled={saving}>Index text</button></div>
              </form>
            )}
            {pinnedOpen && (
              <form className="knowledge-inline-editor" onSubmit={addPinned}>
                <label className="field"><span>Questions (one variation per line)</span><textarea onChange={(event) => setPinnedQuestion(event.target.value)} placeholder={"What is your refund policy?\nCan I get a refund?"} required rows={3} value={pinnedQuestion} /></label>
                <label className="field"><span>Exact answer</span><textarea onChange={(event) => setPinnedAnswer(event.target.value)} placeholder="The approved answer visitors should receive…" required rows={4} value={pinnedAnswer} /></label>
                <div><button className="app-secondary-button" onClick={() => setPinnedOpen(false)} type="button">Cancel</button><button className="app-primary-button" disabled={saving}>Pin answer</button></div>
              </form>
            )}
            <div className="source-table">
              {sources.length ? sources.map((source) => (
                <article key={source.id}>
                  <span className="source-icon">{source.rootUrl ? <Globe2 size={17} /> : <FileText size={17} />}</span>
                  <div>
                    <b>{source.name}</b>
                    {source.rootUrl ? (
                      <a href={source.rootUrl} rel="noreferrer" target="_blank">
                        {source.rootUrl}
                      </a>
                    ) : <small>Pasted text</small>}
                  </div>
                  <span><b>{source.documentCount}</b><small>pages</small></span>
                  <i className={`status-pill status-${source.status}`}>
                    {source.status}
                  </i>
                  {source.rootUrl ? <button aria-label="Sync source" onClick={() => syncSource(source.id)} type="button"><RefreshCw size={14} /></button> : <span />}
                </article>
              )) : (
                <div className="table-empty"><FileText size={23} /><b>No sources connected</b><span>Add a website above to start training.</span></div>
              )}
            </div>
            {pinned.length > 0 && (
              <div className="pinned-list">
                <span>Pinned answers</span>
                {pinned.map((item) => (
                  <article key={item.id}>
                    <Pin size={14} />
                    <div><b>{item.title}</b><small>{item.answer}</small></div>
                    <em>{item.useCount} uses</em>
                    <button aria-label="Delete pinned answer" onClick={() => removePinned(item.id)} type="button"><Trash2 size={13} /></button>
                  </article>
                ))}
              </div>
            )}
          </section>
          <aside className="knowledge-summary">
            <span><DatabaseZap size={17} /></span>
            <h3>How retrieval works</h3>
            <p>
              Every page is converted into overlapping passages and indexed
              with both semantic vectors and full-text search.
            </p>
            <ul>
              <li><CheckCircle2 size={13} /> Citations remain linked to their page</li>
              <li><CheckCircle2 size={13} /> Duplicate content is discarded</li>
              <li><CheckCircle2 size={13} /> Low-confidence answers fall back</li>
            </ul>
          </aside>
        </div>
      )}

      {tab === "playground" && (
        <div className="playground-layout">
          <section>
            <span className="page-eyebrow">Live test</span>
            <h2>Ask your knowledge base anything.</h2>
            <p>
              This uses the same public chat endpoint as the widget. Inspect the
              source cards under every grounded response.
            </p>
            <div className="playground-tips">
              <b>Try asking</b>
              {["What does this company offer?", "How can I contact support?", "What is your refund policy?"].map((item) => (
                <button key={item} type="button">{item}</button>
              ))}
            </div>
          </section>
          <ChatPanel
            agentId={agent.id}
            collectFeedback={agent.collectFeedback}
            embedToken={previewToken}
            iconUrl={agent.iconUrl}
            logoUrl={agent.logoUrl}
            name={agent.name}
            primaryColor={agent.primaryColor}
            showBranding={agent.showBranding}
            welcomeMessage={agent.welcomeMessage}
          />
        </div>
      )}

      {tab === "behavior" && (
        <div className="settings-layout">
          <section className="settings-panel">
            <div className="panel-heading"><div><h2>Instructions</h2><p>Control voice, boundaries, and response behavior.</p></div><Settings2 size={18} /></div>
            <label className="field">
              <span>System prompt</span>
              <textarea rows={8} value={agent.systemPrompt} onChange={(event) => patch("systemPrompt", event.target.value)} />
              <small>The grounded-context rules are enforced separately.</small>
            </label>
            <div className="two-fields">
              <label className="field"><span>Welcome message</span><textarea rows={3} value={agent.welcomeMessage} onChange={(event) => patch("welcomeMessage", event.target.value)} /></label>
              <label className="field"><span>Fallback message</span><textarea rows={3} value={agent.fallbackMessage} onChange={(event) => patch("fallbackMessage", event.target.value)} /></label>
            </div>
          </section>
          <aside className="settings-panel compact-settings">
            <h3>Answer safeguards</h3>
            <Toggle label="Strict grounded mode" detail="Refuse when evidence is weak." value={agent.strictMode} onChange={(value) => patch("strictMode", value)} />
            <Toggle label="Show citations" detail="Link answers to original pages." value={agent.showCitations} onChange={(value) => patch("showCitations", value)} />
            <Toggle label="Collect feedback" detail="Ask visitors if answers helped." value={agent.collectFeedback} onChange={(value) => patch("collectFeedback", value)} />
            <label className="field">
              <span>Answer engine</span>
              <select value={agent.modelProvider} onChange={(event) => patch("modelProvider", event.target.value)}>
                <option value="extractive">Extractive (zero setup)</option>
                <option value="ollama">Ollama Cloud (grounded generation)</option>
              </select>
            </label>
            {agent.modelProvider === "ollama" && (
              <label className="field"><span>Ollama model</span><input placeholder="gemma4:31b" value={agent.modelName || ""} onChange={(event) => patch("modelName", event.target.value || null)} /></label>
            )}
          </aside>
        </div>
      )}

      {tab === "appearance" && (
        <div className="appearance-layout">
          <section className="settings-panel">
            <div className="panel-heading"><div><h2>Widget appearance</h2><p>Match the agent to your product.</p></div><Palette size={18} /></div>
            <label className="field"><span>Agent name</span><input value={agent.name} onChange={(event) => patch("name", event.target.value)} /></label>
            <label className="field"><span>Description</span><input value={agent.description} onChange={(event) => patch("description", event.target.value)} /></label>
            <label className="field">
              <span>Primary color</span>
              <div className="color-field"><input type="color" value={agent.primaryColor} onChange={(event) => patch("primaryColor", event.target.value)} /><input value={agent.primaryColor} onChange={(event) => patch("primaryColor", event.target.value)} /></div>
            </label>
            <div className="two-fields">
              <label className="field">
                <span>Logo URL</span>
                <input
                  onChange={(event) => patch("logoUrl", event.target.value || null)}
                  placeholder={agent.logoUrl?.startsWith("data:") ? "Inline SVG detected from the website" : "https://example.com/logo.svg"}
                  type="url"
                  value={agent.logoUrl?.startsWith("data:") ? "" : agent.logoUrl || ""}
                />
                <small>Detected automatically. Override it with a public image URL.</small>
              </label>
              <label className="field">
                <span>Icon URL</span>
                <input
                  onChange={(event) => patch("iconUrl", event.target.value || null)}
                  placeholder="https://example.com/icon.png"
                  type="url"
                  value={agent.iconUrl || ""}
                />
                <small>Used for the launcher and as a logo fallback.</small>
              </label>
            </div>
            <label className="field"><span>Widget position</span><select value={agent.widgetPosition} onChange={(event) => patch("widgetPosition", event.target.value)}><option value="right">Bottom right</option><option value="left">Bottom left</option></select></label>
            {isAdmin ? (
              <Toggle
                detail="Hide or show the Docent attribution below the composer."
                label='Show "Powered by Docent"'
                onChange={(value) => patch("showBranding", value)}
                value={agent.showBranding}
              />
            ) : null}
          </section>
          <div className="appearance-preview">
            <span>Preview</span>
            <ChatPanel agentId={agent.id} collectFeedback={agent.collectFeedback} embedToken={previewToken} iconUrl={agent.iconUrl} logoUrl={agent.logoUrl} name={agent.name} primaryColor={agent.primaryColor} showBranding={agent.showBranding} welcomeMessage={agent.welcomeMessage} />
          </div>
        </div>
      )}

      {tab === "deploy" && (
        <div className="deploy-grid">
          <section className="settings-panel">
            <div className="panel-heading"><div><h2>Install on your website</h2><p>Paste this once before the closing body tag.</p></div><Code2 size={18} /></div>
            <div className="code-block"><code>{embedCode}</code><button onClick={() => navigator.clipboard.writeText(embedCode)} type="button"><Clipboard size={14} /> Copy</button></div>
            <div className="deploy-check"><CheckCircle2 size={17} /><div><b>No framework required</b><p>The loader is asynchronous and isolates the widget inside an iframe.</p></div></div>
            <div className="deploy-check"><CheckCircle2 size={17} /><div><b>Domain controls</b><p>Use the allowlist below before sharing a production agent.</p></div></div>
            <label className="field"><span>Allowed domains (one per line)</span><textarea rows={5} placeholder={"example.com\napp.example.com"} value={agent.allowedDomains.join("\n")} onChange={(event) => patch("allowedDomains", event.target.value.split(/\n/).map((item) => item.trim()).filter(Boolean))} /></label>
          </section>
          <aside className="deploy-preview-card">
            <span><Globe2 size={18} /></span><h3>Public widget</h3>
            <p>Open the hosted widget in a clean tab and test it on mobile.</p>
            <Link href={`/widget/${agent.id}?token=${encodeURIComponent(previewToken)}`} target="_blank">Open widget <ExternalLink size={13} /></Link>
          </aside>
        </div>
      )}
    </>
  );
}

function Toggle({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span><b>{label}</b><small>{detail}</small></span>
      <input checked={value} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <i />
    </label>
  );
}
