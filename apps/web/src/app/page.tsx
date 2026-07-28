import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpenCheck,
  Bot,
  Check,
  Code2,
  Database,
  GitFork,
  Globe2,
  Inbox,
  LockKeyhole,
  MessageSquareText,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AgentDemo } from "@/components/landing/agent-demo";
import {
  BrandPlayground,
  FaqList,
  HomepageNav,
  IndexingPreview,
  WorkflowExplorer,
} from "@/components/landing/home-interactions";
import { Logo } from "@/components/logo";

const benchmark = [
  ["92", "sitemap URLs found"],
  ["88", "useful pages retained"],
  ["88k", "characters extracted"],
  ["58s", "local crawl time"],
];

const included = [
  {
    icon: Globe2,
    title: "Website and sitemap training",
    text: "Static pages and JavaScript-rendered sites, with robots rules, soft-404 detection, deduplication, and bounded crawling.",
  },
  {
    icon: BookOpenCheck,
    title: "Grounded answers",
    text: "Hybrid retrieval, source citations, pinned answers, and an evidence threshold that refuses unsupported questions.",
  },
  {
    icon: Inbox,
    title: "Conversation inbox",
    text: "Full transcripts, feedback, visitor details, operator notes, and a clear path from automation to human review.",
  },
  {
    icon: MousePointerClick,
    title: "Agent actions",
    text: "Define JSON actions, collect leads, and connect the support experience to the workflows your team already owns.",
  },
];

const selfHostedFeatures = [
  "Unlimited agents in your own deployment",
  "Website, text, and file sources",
  "Embeddable branded widget",
  "Local embeddings with Ollama Cloud generation",
  "Conversations, leads, feedback, and analytics",
  "PostgreSQL and pgvector storage",
];

const faqs = [
  {
    question: "Does Docent really crawl JavaScript websites?",
    answer:
      "Yes. It uses a fast HTTP path first, then opens a controlled browser only when a page returns an empty JavaScript shell. That keeps ordinary sites fast without losing content from modern React and Next.js websites.",
  },
  {
    question: "How does it avoid making up answers?",
    answer:
      "Every response begins with retrieved passages from your sources. Weak evidence produces a refusal instead of a confident guess, citations show the supporting page, and pinned answers can override retrieval for critical questions.",
  },
  {
    question: "What does free and open source mean here?",
    answer:
      "The application code, crawler, worker, retrieval pipeline, dashboard, and widget run on infrastructure you control. You still pay for your own hosting or model hardware, but Docent does not require a paid AI API.",
  },
  {
    question: "Can the widget match my website?",
    answer:
      "The crawler detects a site name, icon, logo, and dominant color. You can then adjust the agent name, welcome message, theme color, launcher, and allowed domains before publishing.",
  },
  {
    question: "Is it ready for sensitive production data?",
    answer:
      "The current build includes workspace boundaries, signed widget tokens, URL safety checks, rate limits, and structured errors. A serious production deployment should still add real authentication, encrypted backups, secret management, audit retention, and a reviewed privacy policy.",
  },
];

export default function Home() {
  return (
    <main className="home-page">
      <HomepageNav />

      <section className="home-hero" id="top">
        <div className="home-shell home-hero-grid">
          <div className="home-hero-copy">
            <h1>
              Build a support agent from the knowledge you already own.
            </h1>
            <p>
              Point Docent at your website. It reads the useful pages,
              remembers where every fact came from, and gives your customers
              a fast answer or an honest “I don&apos;t know.”
            </p>
            <form
              className="home-url-form"
              action="/dashboard/agents/new"
            >
              <Globe2 size={19} aria-hidden="true" />
              <input
                name="url"
                type="url"
                aria-label="Website URL"
                placeholder="https://yourwebsite.com"
              />
              <button type="submit">
                Train my site <ArrowRight size={16} />
              </button>
            </form>
            <div className="home-hero-actions">
              <Link href="/dashboard" className="home-primary-link">
                Open the dashboard <ArrowRight size={16} />
              </Link>
              <a
                href="https://github.com/Motasaith/docent"
                className="home-text-link"
              >
                <GitFork size={16} /> View source
              </a>
            </div>
            <ul className="home-hero-facts" aria-label="Product facts">
              <li><Check size={14} /> No paid AI API required</li>
              <li><Check size={14} /> Your database, your data</li>
              <li><Check size={14} /> Working widget included</li>
            </ul>
          </div>

          <div className="home-product-scene">
            <div className="home-browser">
              <div className="home-browser-bar">
                <span className="home-browser-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="home-browser-url">
                  <LockKeyhole size={11} /> acme.help
                </span>
                <span className="home-browser-state">Preview</span>
              </div>
              <div className="home-browser-body">
                <div className="home-mock-site" aria-hidden="true">
                  <span className="home-mock-brand" />
                  <span className="home-mock-nav" />
                  <strong>Answers without the ticket queue.</strong>
                  <span className="home-mock-copy" />
                  <span className="home-mock-copy short" />
                  <span className="home-mock-button" />
                </div>
                <AgentDemo />
              </div>
            </div>
            <IndexingPreview />
          </div>
        </div>
      </section>

      <section className="home-benchmark" aria-label="Live crawler benchmark">
        <div className="home-shell home-benchmark-grid">
          <div className="home-benchmark-intro">
            <RefreshCw size={17} />
            <span>
              <b>Tested on a real JavaScript-rendered sitemap</b>
              <small>Local benchmark, 92 public URLs</small>
            </span>
          </div>
          {benchmark.map(([value, label]) => (
            <div className="home-benchmark-stat" key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="home-section home-workflow" id="workflow">
        <div className="home-shell">
          <div className="home-section-heading home-heading-split">
            <h2>From a URL to a useful answer.</h2>
            <p>
              The training path is inspectable at every stage. You can see
              what was discovered, what was retained, and what supported each
              response.
            </p>
          </div>
          <WorkflowExplorer />
        </div>
      </section>

      <section className="home-section home-platform" id="platform">
        <div className="home-shell">
          <div className="home-section-heading">
            <h2>The work starts after the first answer.</h2>
            <p>
              Review conversations, improve weak responses, adapt the widget,
              and connect the agent to real support work.
            </p>
          </div>

          <div className="home-platform-grid">
            <article className="home-feature-card home-inbox-card">
              <div className="home-card-title">
                <Inbox size={19} />
                <span>
                  <b>Conversation inbox</b>
                  <small>Every answer stays reviewable</small>
                </span>
              </div>
              <div className="home-thread-list">
                {[
                  ["DW", "Duplicate subscription charge", "Resolved", "2m"],
                  ["TO", "API limits for our launch", "Open", "11m"],
                  ["LS", "Needs a billing specialist", "Handoff", "26m"],
                ].map(([initials, title, status, time], index) => (
                  <div className="home-thread" key={title}>
                    <span data-tone={index}>{initials}</span>
                    <div>
                      <b>{title}</b>
                      <small>{status}</small>
                    </div>
                    <time>{time}</time>
                  </div>
                ))}
              </div>
              <Link href="/dashboard/activity">
                Review conversations <ArrowRight size={14} />
              </Link>
            </article>

            <article className="home-feature-card home-quality-card">
              <div className="home-card-title">
                <BarChart3 size={19} />
                <span>
                  <b>Answer quality</b>
                  <small>Evidence, not vanity metrics</small>
                </span>
              </div>
              <div className="home-quality-main">
                <strong>91%</strong>
                <span>grounded resolution</span>
              </div>
              <div className="home-chart" aria-hidden="true">
                {[36, 48, 43, 57, 55, 66, 64, 75, 81, 79, 88, 91].map(
                  (height, index) => (
                    <i key={index} style={{ height: `${height}%` }} />
                  ),
                )}
              </div>
              <div className="home-quality-foot">
                <span><i /> Answered with sources</span>
                <b>+12% this month</b>
              </div>
            </article>

            <BrandPlayground />

            <article className="home-feature-card home-action-card">
              <div className="home-card-title">
                <MousePointerClick size={19} />
                <span>
                  <b>Actions and handoff</b>
                  <small>Finish work or involve a person</small>
                </span>
              </div>
              <div className="home-action-flow">
                <span><MessageSquareText size={15} /> Customer asks</span>
                <i />
                <span><Bot size={15} /> Agent checks evidence</span>
                <i />
                <span><Users size={15} /> Human gets context</span>
              </div>
              <div className="home-handoff">
                <span className="home-handoff-icon">
                  <Users size={17} />
                </span>
                <div>
                  <b>Handoff requested</b>
                  <small>Transcript and matched sources attached</small>
                </div>
                <button type="button">Accept</button>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="home-section home-human">
        <div className="home-shell home-human-grid">
          <div className="home-human-image">
            <Image
              src="/marketing/support-workflow.png"
              width={1536}
              height={1024}
              sizes="(max-width: 900px) 100vw, 56vw"
              alt="A support operator reviewing customer conversations connected to product documentation"
              priority={false}
            />
            <div className="home-image-caption">
              <ShieldCheck size={16} />
              Sources stay attached from document to answer
            </div>
          </div>
          <div className="home-human-copy">
            <h2>Automation should make support more human, not less.</h2>
            <p>
              Docent handles the repeated questions and preserves the context
              for the ones that need judgment. Your team sees the source,
              conversation, feedback, and visitor details in one place.
            </p>
            <div className="home-human-list">
              <span>
                <BadgeCheck size={18} />
                <b>Verified replies</b>
                <small>Every factual answer can point back to evidence.</small>
              </span>
              <span>
                <Users size={18} />
                <b>Context-rich handoff</b>
                <small>People start where the agent stopped.</small>
              </span>
              <span>
                <RefreshCw size={18} />
                <b>Continuous improvement</b>
                <small>Feedback and pinned answers close knowledge gaps.</small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section home-included" id="included">
        <div className="home-shell">
          <div className="home-section-heading home-heading-split">
            <h2>A working platform, not a landing-page promise.</h2>
            <p>
              These capabilities exist in the current application today. The
              roadmap is kept separate so “planned” never looks like
              “shipped.”
            </p>
          </div>
          <div className="home-included-grid">
            {included.map((item) => (
              <article key={item.title}>
                <item.icon size={21} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <span><Check size={13} /> Available now</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section home-open" id="open-source">
        <div className="home-shell home-open-grid">
          <div className="home-open-copy">
            <h2>Keep the support brain where you can inspect it.</h2>
            <p>
              Run the crawler, worker, retrieval, dashboard, and widget on
              infrastructure you control. Choose local models now and add
              hosted providers later without replacing the product.
            </p>
            <div className="home-open-points">
              <span><Database size={16} /> PostgreSQL + pgvector</span>
              <span><ShieldCheck size={16} /> Signed public widget access</span>
              <span><Code2 size={16} /> Provider adapters</span>
              <span><GitFork size={16} /> Source available on GitHub</span>
            </div>
            <a
              className="home-light-button"
              href="https://github.com/Motasaith/docent"
            >
              Explore the repository <ArrowRight size={16} />
            </a>
          </div>
          <div className="home-terminal" aria-label="Local setup commands">
            <div className="home-terminal-bar">
              <span><i /><i /><i /></span>
              <b>powershell</b>
            </div>
            <pre><code>
              <span>PS</span> git clone Motasaith/docent.git{"\n"}
              <span>PS</span> npm install{"\n"}
              <span>PS</span> npm run services:up{"\n"}
              <span>PS</span> npm run db:migrate{"\n"}
              <span>PS</span> npm run dev{"\n\n"}
              <em>ready</em> web and worker running{"\n"}
              <em>ready</em> PostgreSQL connected{"\n"}
              <em>ready</em> local embeddings available
            </code></pre>
          </div>
        </div>
      </section>

      <section className="home-section home-deploy" id="deploy">
        <div className="home-shell">
          <div className="home-section-heading home-heading-split">
            <h2>Free software. Honest infrastructure costs.</h2>
            <p>
              There is no pretend pricing for a billing system that does not
              exist yet. Self-host the complete current product now; a managed
              service can come later.
            </p>
          </div>
          <div className="home-deploy-grid">
            <article className="home-deploy-card available">
              <span className="home-deploy-status">Available now</span>
              <h3>Self-hosted</h3>
              <div className="home-price">$0 <small>software license</small></div>
              <p>You pay only for the infrastructure and models you choose.</p>
              <ul>
                {selfHostedFeatures.map((feature) => (
                  <li key={feature}><Check size={14} /> {feature}</li>
                ))}
              </ul>
              <Link href="/dashboard">
                Build an agent <ArrowRight size={15} />
              </Link>
            </article>
            <article className="home-deploy-card planned">
              <span className="home-deploy-status">Planned, not sold</span>
              <h3>Managed Docent</h3>
              <div className="home-price">Later</div>
              <p>
                Hosted workers, managed upgrades, backups, team billing, and
                production support.
              </p>
              <div className="home-planned-stack">
                <span>Managed browser workers</span>
                <span>Encrypted backups</span>
                <span>Usage metering and billing</span>
                <span>Regional deployment options</span>
              </div>
              <a href="#roadmap">See what remains</a>
            </article>
          </div>
        </div>
      </section>

      <section className="home-section home-faq" id="faq">
        <div className="home-shell home-faq-grid">
          <div className="home-faq-copy">
            <h2>Questions worth answering clearly.</h2>
            <p>
              No invented customer counts, fake testimonials, or feature
              badges for work that has not shipped.
            </p>
            <Link href="/dashboard" className="home-text-link">
              Test the product yourself <ArrowRight size={15} />
            </Link>
          </div>
          <FaqList items={faqs} />
        </div>
      </section>

      <section className="home-final" id="roadmap">
        <div className="home-shell home-final-card">
          <div>
            <h2>Your documentation is already doing the hard part.</h2>
            <p>
              Give it a support interface your customers can actually use.
            </p>
          </div>
          <Link href="/dashboard" className="home-final-button">
            Create your first agent <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-shell home-footer-grid">
          <div>
            <Logo inverse />
            <p>Open-source support agents trained on your knowledge.</p>
          </div>
          <div>
            <b>Product</b>
            <a href="#workflow">How it works</a>
            <a href="#platform">Platform</a>
            <Link href="/dashboard">Dashboard</Link>
          </div>
          <div>
            <b>Project</b>
            <a href="#open-source">Open source</a>
            <a href="#deploy">Deployment</a>
            <a href="#roadmap">Roadmap</a>
          </div>
          <div className="home-footer-status">
            <i /> Local-first and operational
          </div>
        </div>
      </footer>
    </main>
  );
}
