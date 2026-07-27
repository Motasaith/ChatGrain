import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpenText,
  Bot,
  Check,
  Code2,
  DatabaseZap,
  GitFork,
  Globe2,
  MessagesSquare,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { AgentDemo } from "@/components/landing/agent-demo";
import { Logo } from "@/components/logo";

const capabilities = [
  {
    icon: Globe2,
    title: "Give it one URL",
    text: "Docent discovers the useful pages, respects crawl rules, cleans the content, and detects your visual identity.",
    tag: "Sitemap-first crawling",
  },
  {
    icon: DatabaseZap,
    title: "Train with hybrid search",
    text: "Local embeddings and full-text search work together, then rerank the strongest passages for every question.",
    tag: "Vector + keyword",
  },
  {
    icon: Code2,
    title: "Install one tiny script",
    text: "Ship a fast, isolated widget that inherits your logo, color, welcome message, and allowed domains.",
    tag: "Framework agnostic",
  },
];

const checks = [
  "Citations on grounded answers",
  "Strict refusal when evidence is weak",
  "No paid AI API required",
  "Your data stays on your infrastructure",
];

export default function Home() {
  return (
    <main className="marketing">
      <header className="marketing-nav">
        <div className="marketing-container nav-inner">
          <Logo />
          <nav className="desktop-links" aria-label="Main navigation">
            <a href="#workflow">How it works</a>
            <a href="#platform">Platform</a>
            <a href="#open-source">Open source</a>
            <a href="#roadmap">Roadmap</a>
          </nav>
          <div className="nav-actions">
            <Link href="/dashboard" className="button button-ghost nav-login">
              Sign in
            </Link>
            <Link href="/dashboard" className="button button-primary button-sm">
              Build an agent <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </header>

      <section className="hero-section">
        <div className="hero-noise" aria-hidden="true" />
        <div className="marketing-container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-pulse" />
              Open-source customer support agents
            </div>
            <h1>
              Your website already knows the answer.
              <span> Put it to work.</span>
            </h1>
            <p className="hero-description">
              Docent turns websites and documents into a support agent that
              answers in seconds, shows its sources, and knows when not to
              guess.
            </p>
            <form className="hero-url" action="/dashboard/agents/new">
              <Globe2 size={18} aria-hidden="true" />
              <input
                name="url"
                type="url"
                aria-label="Website URL"
                placeholder="https://yourwebsite.com"
              />
              <button type="submit">
                Train free <ArrowRight size={16} />
              </button>
            </form>
            <div className="hero-proof">
              <span>
                <Check size={14} /> Runs locally
              </span>
              <span>
                <Check size={14} /> No card
              </span>
              <span>
                <Check size={14} /> Own your data
              </span>
            </div>
          </div>
          <div className="hero-product">
            <div className="product-glow" />
            <AgentDemo />
            <div className="floating-note note-indexed">
              <span className="floating-icon">
                <RefreshCw size={14} />
              </span>
              <span>
                <b>126 pages indexed</b>
                <small>Brand matched automatically</small>
              </span>
            </div>
            <div className="floating-note note-grounded">
              <span className="floating-icon safe">
                <ShieldCheck size={14} />
              </span>
              <span>
                <b>Grounded answer</b>
                <small>2 passages · 418 ms</small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="signal-strip" aria-label="Product capabilities">
        <div className="marketing-container signal-list">
          <span>
            <Sparkles size={15} /> Automatic branding
          </span>
          <span>
            <BookOpenText size={15} /> Verifiable citations
          </span>
          <span>
            <MessagesSquare size={15} /> Human-ready inbox
          </span>
          <span>
            <Zap size={15} /> Local AI
          </span>
          <span>
            <GitFork size={15} /> Open source
          </span>
        </div>
      </section>

      <section className="marketing-section workflow-section" id="workflow">
        <div className="marketing-container">
          <div className="section-heading split-heading">
            <div>
              <span className="section-kicker">From URL to useful</span>
              <h2>Three steps. No mystery.</h2>
            </div>
            <p>
              Every stage is visible: what we fetched, what was indexed, and
              which source produced an answer.
            </p>
          </div>
          <div className="workflow-grid">
            {capabilities.map((item, index) => (
              <article className="workflow-card" key={item.title}>
                <div className="workflow-number">0{index + 1}</div>
                <div className="workflow-icon">
                  <item.icon size={21} />
                </div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <span className="workflow-tag">{item.tag}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section platform-section" id="platform">
        <div className="marketing-container">
          <div className="section-heading centered-heading">
            <span className="section-kicker">A complete support loop</span>
            <h2>Answers are only the beginning.</h2>
            <p>
              Train, deploy, review, improve, and hand off without stitching
              together five separate products.
            </p>
          </div>
          <div className="platform-grid">
            <article className="platform-card platform-large">
              <div className="card-label">
                <Bot size={15} /> Agent builder
              </div>
              <h3>Grounded by design, not by marketing.</h3>
              <p>
                Hybrid retrieval, pinned answers, confidence thresholds, and
                citations work together before a response reaches your user.
              </p>
              <div className="retrieval-visual">
                <div className="query-pill">
                  “Can I get a refund for a duplicate charge?”
                </div>
                <div className="retrieval-path">
                  <span>Vector</span>
                  <i />
                  <span>Keyword</span>
                  <i />
                  <span>Rerank</span>
                </div>
                <div className="source-result">
                  <BadgeCheck size={17} />
                  <span>
                    <b>refund-policy.md</b>
                    <small>0.94 relevance · paragraph 7</small>
                  </span>
                </div>
              </div>
            </article>
            <article className="platform-card inbox-card">
              <div className="card-label">
                <MessagesSquare size={15} /> Shared inbox
              </div>
              <h3>See what customers actually need.</h3>
              <div className="mini-inbox">
                {[
                  ["AR", "Refund on duplicate charge", "resolved", "2m"],
                  ["TM", "SSO setup for our team", "open", "8m"],
                  ["LS", "Needs a person", "handoff", "21m"],
                ].map(([initials, title, status, time]) => (
                  <div className="mini-thread" key={title}>
                    <span className="mini-avatar">{initials}</span>
                    <span className="mini-thread-copy">
                      <b>{title}</b>
                      <small>{status}</small>
                    </span>
                    <time>{time}</time>
                  </div>
                ))}
              </div>
            </article>
            <article className="platform-card analytics-card">
              <div className="card-label">
                <BarChart3 size={15} /> Quality
              </div>
              <h3>Improve from evidence.</h3>
              <div className="quality-score">
                <strong>91%</strong>
                <span>grounded resolution</span>
              </div>
              <div className="quality-bars" aria-hidden="true">
                {[44, 58, 51, 67, 62, 76, 83, 79, 88, 91].map(
                  (height, index) => (
                    <i key={index} style={{ height: `${height}%` }} />
                  ),
                )}
              </div>
            </article>
            <article className="platform-card actions-card">
              <div className="card-label">
                <MousePointerClick size={15} /> Actions
              </div>
              <h3>Let the agent finish the job.</h3>
              <div className="action-list">
                <span>
                  <Check size={14} /> Capture a qualified lead
                </span>
                <span>
                  <Check size={14} /> Call your own JSON API
                </span>
                <span>
                  <Check size={14} /> Escalate with full context
                </span>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="marketing-section open-section" id="open-source">
        <div className="marketing-container open-grid">
          <div>
            <span className="section-kicker light">Actually open source</span>
            <h2>Your support brain should not be a black box.</h2>
            <p>
              Run Docent on your own infrastructure, inspect the retrieval
              pipeline, choose your model, and keep customer data where you
              decide.
            </p>
            <div className="open-checks">
              {checks.map((check) => (
                <span key={check}>
                  <Check size={15} /> {check}
                </span>
              ))}
            </div>
            <div className="open-actions">
              <Link href="/dashboard" className="button button-mint">
                Start building <ArrowRight size={16} />
              </Link>
              <a className="button button-dark-outline" href="#roadmap">
                View the roadmap
              </a>
            </div>
          </div>
          <div className="terminal-card" aria-label="Local setup example">
            <div className="terminal-head">
              <span />
              <span />
              <span />
              <b>terminal</b>
            </div>
            <pre>
              <code>
                <span className="terminal-muted">$</span> git clone
                docent-ai/docent{"\n"}
                <span className="terminal-muted">$</span> docker compose up -d
                {"\n"}
                <span className="terminal-muted">$</span> npm install{"\n"}
                <span className="terminal-muted">$</span> npm run db:push{"\n"}
                <span className="terminal-muted">$</span> npm run dev{"\n\n"}
                <span className="terminal-green">✓</span> dashboard{" "}
                <span className="terminal-muted">localhost:3000</span>
                {"\n"}
                <span className="terminal-green">✓</span> pgvector{" "}
                <span className="terminal-muted">connected</span>
                {"\n"}
                <span className="terminal-green">✓</span> worker{" "}
                <span className="terminal-muted">ready</span>
              </code>
            </pre>
          </div>
        </div>
      </section>

      <section className="marketing-section roadmap-section" id="roadmap">
        <div className="marketing-container roadmap-card">
          <div>
            <span className="section-kicker">Built for the long run</span>
            <h2>Small-team simple. Scale-ready underneath.</h2>
            <p>
              One PostgreSQL database is enough today. Durable jobs, provider
              adapters, workspace isolation, and indexed retrieval keep the
              architecture ready for tomorrow.
            </p>
          </div>
          <Link href="/dashboard" className="button button-primary">
            Open the dashboard <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <footer className="marketing-footer">
        <div className="marketing-container footer-grid">
          <div>
            <Logo inverse />
            <p>Support answers that show their work.</p>
          </div>
          <div>
            <b>Product</b>
            <a href="#workflow">How it works</a>
            <a href="#platform">Platform</a>
            <Link href="/dashboard">Dashboard</Link>
          </div>
          <div>
            <b>Build</b>
            <a href="#open-source">Self-host</a>
            <a href="#roadmap">Roadmap</a>
            <a href="/api/health">System health</a>
          </div>
          <div className="footer-status">
            <span />
            Local-first and operational
          </div>
        </div>
      </footer>
    </main>
  );
}
