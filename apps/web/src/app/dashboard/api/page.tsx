import { Braces, Code2, KeyRound, ShieldCheck } from "lucide-react";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export default function ApiPage() {
  const chat = `curl -X POST ${appUrl}/api/chat/AGENT_ID \\\n  -H "Content-Type: application/json" \\\n  -d '{"sessionId":"your-stable-session-id","message":"How do I get started?"}'`;
  const embed = `<script src="${appUrl}/embed.js" data-agent-id="AGENT_ID" async></script>`;
  return (
    <>
      <div className="page-heading"><div><span className="page-eyebrow">Developer API</span><h1>Build on the same grounded runtime</h1><p>Use the chat endpoint directly or install the isolated website widget.</p></div></div>
      <div className="api-layout">
        <section className="settings-panel">
          <div className="panel-heading"><div><h2>Chat API</h2><p>Creates or continues a conversation and returns citations.</p></div><Braces size={18} /></div>
          <div className="endpoint-line"><span>POST</span><code>/api/chat/:agentId</code></div>
          <pre className="docs-code">{chat}</pre>
          <h3>Response fields</h3>
          <div className="field-table">
            <div><code>answer</code><span>Grounded response or configured fallback</span></div>
            <div><code>citations[]</code><span>Source title, URL, excerpt, and chunk ID</span></div>
            <div><code>confidence</code><span>Retrieval confidence from zero to one</span></div>
            <div><code>conversationId</code><span>Pass back to continue the thread</span></div>
            <div><code>requestId</code><span>Trace identifier for operational debugging</span></div>
          </div>
        </section>
        <aside className="settings-panel api-side">
          <span><Code2 size={18} /></span><h3>Widget snippet</h3><pre className="docs-code">{embed}</pre>
          <span><ShieldCheck size={18} /></span><h3>Public API safety</h3><p>Per-IP rate limits, payload limits, strict validation, and allowed-domain controls are built in.</p>
          <span><KeyRound size={18} /></span><h3>Server API keys</h3><p>Workspace management routes are session-protected. Use the widget endpoint only from untrusted clients.</p>
        </aside>
      </div>
    </>
  );
}
