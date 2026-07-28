import { Braces, CheckCircle2, Database, HardDrive, Plug, Radio, TriangleAlert } from "lucide-react";

const integrations = [
  { name: "PostgreSQL + pgvector", detail: "Knowledge, conversations, jobs, vectors, and analytics.", status: "connected", icon: Database },
  { name: "Transformers.js", detail: "Local multilingual-ready embedding runtime with a deterministic fallback.", status: "connected", icon: HardDrive },
  { name: "Ollama Cloud", detail: "Default grounded answer engine through Ollama's OpenAI-compatible cloud endpoint.", status: process.env.LLM_API_KEY ? "configured" : "needs key", icon: Braces },
  { name: "Sentry", detail: "Browser, server, route, and worker error reporting with an administrator issue feed.", status: process.env.SENTRY_DSN ? "configured" : "needs DSN", icon: TriangleAlert },
  { name: "Clerk", detail: "Hosted authentication with per-user Docent workspaces and protected administration.", status: process.env.AUTH_PROVIDER === "clerk" ? "configured" : "development", icon: Radio },
] as const;

export default function IntegrationsPage() {
  return (
    <>
      <div className="page-heading"><div><span className="page-eyebrow">Integrations</span><h1>Runtime and services</h1><p>Keep retrieval local and connect cloud generation where it improves the answer.</p></div></div>
      <div className="integration-grid">
        {integrations.map((integration) => (
          <article key={integration.name}>
            <span><integration.icon size={20} /></span>
            <i className={integration.status === "connected" || integration.status === "configured" ? "integration-on" : ""}>
              {integration.status === "connected" || integration.status === "configured" ? <CheckCircle2 size={11} /> : <Plug size={11} />}
              {integration.status}
            </i>
            <h2>{integration.name}</h2>
            <p>{integration.detail}</p>
          </article>
        ))}
      </div>
      <div className="config-note integration-note">
        Secrets stay in environment variables. The application never exposes
        database, Ollama, auth, or monitoring credentials to the browser.
      </div>
    </>
  );
}
