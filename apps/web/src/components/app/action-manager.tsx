"use client";

import { useState } from "react";
import { Braces, LoaderCircle, Plus, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";

type AgentOption = { id: string; name: string };
type Action = { id: string; name: string; description: string; type: string; enabled: boolean; agentId: string; agentName: string };

export function ActionManager({ initialActions, agents }: { initialActions: Action[]; agents: AgentOption[] }) {
  const [list, setList] = useState(initialActions);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id || "");
  const [type, setType] = useState("lead_form");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, agentId, type }) });
    const payload = await response.json();
    if (response.ok) {
      const agentName = agents.find((agent) => agent.id === agentId)?.name || "";
      setList((current) => [{ ...payload.data, agentName }, ...current]);
      setName("");
      setOpen(false);
    }
    setBusy(false);
  }

  async function change(action: Action, values: Record<string, unknown>) {
    const response = await fetch(`/api/actions/${action.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
    if (response.ok) setList((current) => current.map((item) => item.id === action.id ? { ...item, ...values } as Action : item));
  }

  async function remove(action: Action) {
    if (!window.confirm(`Delete "${action.name}"?`)) return;
    const response = await fetch(`/api/actions/${action.id}`, { method: "DELETE" });
    if (response.ok) setList((current) => current.filter((item) => item.id !== action.id));
  }

  return (
    <>
      <div className="page-heading">
        <div><span className="page-eyebrow">Actions</span><h1>Turn answers into outcomes</h1><p>Collect leads, hand off conversations, open links, and call webhooks.</p></div>
        <button className="app-primary-button" disabled={!agents.length} onClick={() => setOpen(true)}><Plus size={15} /> New action</button>
      </div>
      {open && (
        <form className="inline-create-card" onSubmit={create}>
          <label className="field"><span>Name</span><input autoFocus onChange={(event) => setName(event.target.value)} placeholder="Collect sales lead" required value={name} /></label>
          <label className="field"><span>Agent</span><select onChange={(event) => setAgentId(event.target.value)} value={agentId}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          <label className="field"><span>Type</span><select onChange={(event) => setType(event.target.value)} value={type}><option value="lead_form">Lead form</option><option value="human_handoff">Human handoff</option><option value="link">Open link</option><option value="webhook">Webhook</option><option value="custom_api">Custom API</option></select></label>
          <div><button className="app-secondary-button" onClick={() => setOpen(false)} type="button">Cancel</button><button className="app-primary-button" disabled={busy}>{busy && <LoaderCircle className="spin" size={14} />} Create</button></div>
        </form>
      )}
      <section className="data-card">
        <div className="data-toolbar"><span><Braces size={15} /> Configured actions</span><i>{list.length} total</i></div>
        {list.length ? <div className="action-list">{list.map((action) => (
          <article key={action.id}>
            <span><Braces size={17} /></span>
            <div><b>{action.name}</b><small>{action.type.replaceAll("_", " ")} · {action.agentName}</small></div>
            <button aria-label={action.enabled ? "Disable" : "Enable"} onClick={() => change(action, { enabled: !action.enabled })}>{action.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}</button>
            <button aria-label="Delete" onClick={() => remove(action)}><Trash2 size={14} /></button>
          </article>
        ))}</div> : <div className="data-empty"><Braces size={25} /><b>No actions yet</b><span>Create an agent first, then add a lead form or handoff.</span></div>}
      </section>
    </>
  );
}
