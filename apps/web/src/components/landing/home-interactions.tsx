"use client";

import { Show, UserButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLinkStatus } from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Code2,
  DatabaseZap,
  FileSearch,
  LoaderCircle,
  Menu,
  Paintbrush,
  RefreshCw,
  X,
} from "lucide-react";
import { Logo } from "@/components/logo";

/**
 * Navigation feedback for links into the dashboard.
 *
 * `/dashboard` renders dynamically behind authentication, a workspace lookup,
 * and a database read, and its `loading.tsx` sits inside that layout - so
 * nothing at all paints until the layout resolves. Without this the link looks
 * broken on a slow response. Both icons occupy the same grid cell so swapping
 * them cannot shift the layout.
 */
function NavLinkIcon({ size = 15 }: { size?: number }) {
  const { pending } = useLinkStatus();
  return (
    <span className={`nav-link-icon${pending ? " is-pending" : ""}`} aria-hidden>
      <ArrowRight size={size} />
      <LoaderCircle className="spin" size={size} />
    </span>
  );
}

export function HomepageNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="home-nav">
      <div className="home-shell home-nav-inner">
        <Logo />
        <nav className="home-nav-links" aria-label="Main navigation">
          <a href="#workflow">How it works</a>
          <a href="#platform">Platform</a>
          <a href="#included">What ships</a>
          <a href="#deploy">Deployment</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="home-nav-actions">
          <Show when="signed-out">
            <Link href="/sign-in" className="home-nav-signin">Sign in</Link>
            <Link href="/sign-up" className="home-nav-primary">
              Build an agent <NavLinkIcon />
            </Link>
          </Show>
          <Show when="signed-in">
            <Link href="/dashboard" className="home-nav-primary">
              Open dashboard <NavLinkIcon />
            </Link>
            <UserButton />
          </Show>
          <button
            type="button"
            className="home-menu-button"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {open ? (
        <nav className="home-mobile-menu" aria-label="Mobile navigation">
          {[
            ["How it works", "#workflow"],
            ["Platform", "#platform"],
            ["What ships", "#included"],
            ["Deployment", "#deploy"],
            ["FAQ", "#faq"],
          ].map(([label, href]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {label}<ArrowRight size={14} />
            </a>
          ))}
          <Link href="/dashboard" onClick={() => setOpen(false)}>
            Open dashboard <NavLinkIcon size={14} />
          </Link>
        </nav>
      ) : null}
    </header>
  );
}

const indexedRows = [
  ["Sitemap", "92 URLs discovered"],
  ["Rendering", "88 useful pages"],
  ["Knowledge", "412 passages ready"],
];

export function IndexingPreview() {
  const [run, setRun] = useState(0);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    const timers = indexedRows.map((_, index) =>
      window.setTimeout(() => setReady(index + 1), 550 + index * 620),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [run]);

  return (
    <div className="home-index-card">
      <div className="home-index-head">
        <span>
          <RefreshCw size={14} />
          Training run
        </span>
        <button
          type="button"
          onClick={() => {
            setReady(0);
            setRun((value) => value + 1);
          }}
        >
          Replay
        </button>
      </div>
      <div className="home-index-rows">
        {indexedRows.map(([label, detail], index) => (
          <div className={index < ready ? "ready" : ""} key={label}>
            <span className="home-index-state">
              {index < ready ? <Check size={12} /> : <i />}
            </span>
            <span><b>{label}</b><small>{index < ready ? detail : "Working..."}</small></span>
          </div>
        ))}
      </div>
      <div className="home-index-progress">
        <i style={{ width: `${(ready / indexedRows.length) * 100}%` }} />
      </div>
    </div>
  );
}

const workflowSteps = [
  {
    title: "Discover",
    summary: "Read the site map and follow useful same-domain links.",
    detail:
      "Docent respects robots.txt, rejects private-network URLs, detects redirect loops and soft 404s, and keeps the queue within your page limit.",
    icon: FileSearch,
    visual: ["sitemap.xml", "docs/getting-started", "help/refunds"],
  },
  {
    title: "Extract",
    summary: "Keep the page content and remove the navigation noise.",
    detail:
      "Server-rendered HTML stays on the fast path. Empty React shells are rendered in a controlled browser so modern sites do not train on the word “Loading.”",
    icon: Code2,
    visual: ["Readable content", "Duplicate removed", "Source URL retained"],
  },
  {
    title: "Index",
    summary: "Turn clean content into searchable, cited passages.",
    detail:
      "Text is chunked, embedded in batches, and written beside a full-text index. The old index remains live until the replacement is complete.",
    icon: DatabaseZap,
    visual: ["Vector search", "Keyword search", "Atomic replacement"],
  },
  {
    title: "Answer",
    summary: "Retrieve evidence before generating a response.",
    detail:
      "Pinned answers take priority, hybrid results are reranked, low-confidence questions are refused, and citations stay attached to the conversation.",
    icon: Check,
    visual: ["Evidence: strong", "2 cited passages", "Answer ready"],
  },
];

export function WorkflowExplorer() {
  const [active, setActive] = useState(0);
  const step = workflowSteps[active];

  return (
    <div className="home-workflow-explorer">
      <div className="home-workflow-tabs" role="tablist">
        {workflowSteps.map((item, index) => (
          <button
            type="button"
            role="tab"
            aria-selected={active === index}
            className={active === index ? "active" : ""}
            key={item.title}
            onClick={() => setActive(index)}
          >
            <span>0{index + 1}</span>
            <item.icon size={18} />
            <b>{item.title}</b>
            <small>{item.summary}</small>
          </button>
        ))}
      </div>
      <div className="home-workflow-detail" role="tabpanel">
        <div>
          <span className="home-detail-icon"><step.icon size={23} /></span>
          <h3>{step.title} without hiding the work.</h3>
          <p>{step.detail}</p>
        </div>
        <div className="home-detail-visual">
          <div className="home-detail-bar">
            <i /><i /><i /><span>training.log</span>
          </div>
          {step.visual.map((item, index) => (
            <div key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <b>{item}</b>
              <Check size={14} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const brandColors = ["#187c52", "#356fa9", "#8b5fbf", "#d66b45", "#172b43"];

export function BrandPlayground() {
  const [color, setColor] = useState(brandColors[0]);

  return (
    <article className="home-feature-card home-brand-card">
      <div className="home-card-title">
        <Paintbrush size={19} />
        <span>
          <b>Your brand, not ours</b>
          <small>Try a widget color</small>
        </span>
      </div>
      <div className="home-brand-swatches" aria-label="Widget color">
        {brandColors.map((item) => (
          <button
            type="button"
            key={item}
            aria-label={`Use ${item}`}
            aria-pressed={color === item}
            style={{ background: item }}
            onClick={() => setColor(item)}
          />
        ))}
      </div>
      <div className="home-mini-widget">
        <div style={{ background: color }}>
          <span>AC</span>
          <b>Acme support</b>
          <small>Online</small>
        </div>
        <p>Hi — what can we help you find?</p>
        <span className="home-mini-reply" style={{ background: color }}>
          How do refunds work?
        </span>
      </div>
    </article>
  );
}

export function FaqList({
  items,
}: {
  items: Array<{ question: string; answer: string }>;
}) {
  const [open, setOpen] = useState(0);

  return (
    <div className="home-faq-list">
      {items.map((item, index) => (
        <article className={open === index ? "open" : ""} key={item.question}>
          <button
            type="button"
            aria-expanded={open === index}
            onClick={() => setOpen(open === index ? -1 : index)}
          >
            <span>{item.question}</span>
            <ChevronDown size={18} />
          </button>
          <div className="home-faq-answer">
            <p>{item.answer}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
