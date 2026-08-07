import { Database, TerminalSquare } from "lucide-react";

export function DatabaseSetup({ detail }: { detail?: string }) {
  return (
    <div className="setup-state">
      <span className="setup-icon">
        <Database size={23} />
      </span>
      <div>
        <h2>Connect the local database</h2>
        <p>
          The interface is ready, but PostgreSQL has not been initialized yet.
          Start the local services and push the schema.
        </p>
        <pre>
          <TerminalSquare size={14} />
          <code>npm run services:up{"\n"}npm run db:push</code>
        </pre>
        {detail && <small>{detail}</small>}
      </div>
    </div>
  );
}
