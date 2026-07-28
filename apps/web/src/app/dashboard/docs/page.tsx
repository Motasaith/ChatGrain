import Link from "next/link";
import { BookOpen, CheckCircle2, Code2, Database, ExternalLink, ShieldCheck } from "lucide-react";

export default function DocsPage() {
  return (
    <>
      <div className="page-heading"><div><span className="page-eyebrow">Documentation</span><h1>Run Docent locally</h1><p>A compact guide to development, training, deployment, and reliability.</p></div></div>
      <div className="docs-layout">
        <aside className="docs-toc">
          <b>On this page</b>
          <a href="#quickstart">Quickstart</a><a href="#training">Training pipeline</a><a href="#answers">Grounded answers</a><a href="#production">Production checklist</a>
        </aside>
        <article className="docs-article">
          <section id="quickstart"><span><Database size={17} /></span><h2>Quickstart</h2><p>Copy the environment example, start PostgreSQL, push the schema, and run the web process with its worker.</p><pre className="docs-code">copy .env.example .env.local{"\n"}npm install{"\n"}npm run services:up{"\n"}npm run db:push{"\n"}npm run dev</pre></section>
          <section id="training"><span><BookOpen size={17} /></span><h2>Training pipeline</h2><p>The worker validates public URLs against SSRF, respects robots.txt, checks sitemaps, crawls with bounded concurrency, extracts readable text, deduplicates pages, chunks content, and writes embeddings in batches.</p><ul><li><CheckCircle2 size={13} /> Retries use exponential backoff</li><li><CheckCircle2 size={13} /> Failed jobs retain an actionable error code</li><li><CheckCircle2 size={13} /> Brand metadata is applied after successful extraction</li></ul></section>
          <section id="answers"><span><ShieldCheck size={17} /></span><h2>Grounded answers</h2><p>Hybrid retrieval fuses pgvector similarity with PostgreSQL full-text ranking. Pinned answers win first. Ollama Cloud receives only the retrieved evidence, and weak matches return the configured fallback.</p></section>
          <section id="production"><span><Code2 size={17} /></span><h2>Production checklist</h2><ul><li><CheckCircle2 size={13} /> Activate Clerk production keys and the public domain</li><li><CheckCircle2 size={13} /> Put PostgreSQL on durable encrypted storage with backups</li><li><CheckCircle2 size={13} /> Run the worker as an independent supervised process</li><li><CheckCircle2 size={13} /> Configure Sentry and verify an administrator test event</li><li><CheckCircle2 size={13} /> Review retention, widget domains, quotas, and reverse-proxy TLS</li></ul><Link href="/dashboard/integrations">Review integrations <ExternalLink size={12} /></Link></section>
        </article>
      </div>
    </>
  );
}
