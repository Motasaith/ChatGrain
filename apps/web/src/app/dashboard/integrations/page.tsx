import { Braces, CheckCircle2, Database, HardDrive, Plug, Radio, TriangleAlert } from "lucide-react";

const integrations = [
  { name: "PostgreSQL + pgvector", detail: "Knowledge, conversations, jobs, vectors, and analytics.", status: "connected", icon: Database },
  { name: "Transformers.js", detail: "Local multilingual-ready embedding runtime with a deterministic fallback.", status: "connected", icon: HardDrive },
  { name: "Ollama", detail: "Optional local generative answer engine. Extractive answers work without it.", status: process.env.OLLAMA_MODEL ? "configured" : "optional", icon: Braces },
  { name: "Sentry", detail: "Optional production error tracking adapter; SDK installation is intentionally deferred.", status: "optional", icon: TriangleAlert },
  { name: "Clerk", detail: "Optional hosted authentication adapter for production teams.", status: "optional", icon: Radio },
] as const;

export default function IntegrationsPage() {
  return (
    <>
      <div className="page-heading"><div><span className="page-eyebrow">Integrations</span><h1>Runtime and services</h1><p>Start fully local, then connect managed services only where they help.</p></div></div>
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
