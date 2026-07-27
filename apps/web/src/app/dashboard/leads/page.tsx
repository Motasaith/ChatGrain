import { ContactRound, Mail, Phone, UserRound } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, leads } from "@/lib/db/schema";
import { relativeTime } from "@/lib/format";

export default async function LeadsPage() {
  const workspace = await getWorkspaceContext();
  const rows = await db
    .select({ lead: leads, agentName: agents.name })
    .from(leads)
    .innerJoin(agents, eq(agents.id, leads.agentId))
    .where(eq(agents.workspaceId, workspace.workspaceId))
    .orderBy(desc(leads.createdAt))
    .limit(250);
  return (
    <>
      <div className="page-heading"><div><span className="page-eyebrow">Leads</span><h1>Visitor contacts</h1><p>Contacts collected by lead forms and conversations.</p></div></div>
      <section className="data-card">
        <div className="data-toolbar"><span><ContactRound size={15} /> Captured leads</span><i>{rows.length} total</i></div>
        {rows.length ? (
          <div className="lead-table">
            <div className="table-head"><span>Contact</span><span>Agent</span><span>Phone</span><span>Captured</span></div>
            {rows.map(({ lead, agentName }) => (
              <div key={lead.id}>
                <span className="lead-person"><i><UserRound size={13} /></i><span><b>{lead.name || "Unnamed lead"}</b><small><Mail size={10} /> {lead.email || "No email"}</small></span></span>
                <span>{agentName}</span>
                <span>{lead.phone ? <><Phone size={11} /> {lead.phone}</> : "—"}</span>
                <time>{relativeTime(lead.createdAt)}</time>
              </div>
            ))}
          </div>
        ) : <div className="data-empty"><ContactRound size={25} /><b>No leads captured</b><span>Enable a lead-form action to collect email or phone details.</span></div>}
      </section>
    </>
  );
}
