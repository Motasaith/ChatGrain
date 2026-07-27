"use client";

import { useState } from "react";
import { Check, LoaderCircle, Save } from "lucide-react";

export function WorkspaceSettings({ initialName, slug, email, authProvider }: { initialName: string; slug: string; email: string; authProvider: string }) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    setBusy(false);
    if (response.ok) {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    }
  }

  return (
    <div className="settings-page-grid">
      <form className="settings-panel" onSubmit={submit}>
        <div className="panel-heading"><div><h2>Workspace</h2><p>General information used throughout the dashboard.</p></div></div>
        <label className="field"><span>Workspace name</span><input maxLength={80} onChange={(event) => setName(event.target.value)} required value={name} /></label>
        <label className="field"><span>Workspace slug</span><input disabled value={slug} /><small>Stable identifier. Slug changes are intentionally disabled.</small></label>
        <div className="settings-save-row">
          {saved && <span><Check size={12} /> Saved</span>}
          <button className="app-primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />} Save workspace</button>
        </div>
      </form>
      <aside className="settings-panel">
        <div className="panel-heading"><div><h2>Authentication</h2><p>Identity boundary for this installation.</p></div></div>
        <dl className="system-list">
          <div><dt>Provider</dt><dd>{authProvider}</dd></div>
          <div><dt>Current user</dt><dd>{email}</dd></div>
          <div><dt>Production guard</dt><dd>{authProvider === "dev" ? "Development only" : "Enabled"}</dd></div>
        </dl>
        <div className="config-note">
          Set <code>AUTH_PROVIDER=clerk</code> after installing Clerk and adding
          its middleware adapter. Production rejects accidental dev auth.
        </div>
      </aside>
    </div>
  );
}
