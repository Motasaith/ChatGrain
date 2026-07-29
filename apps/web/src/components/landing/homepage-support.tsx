"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ExternalLink,
  MessageCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { ChatPanel } from "@/components/chat/chat-panel";

type PublicAgent = {
  id: string;
  name: string;
  welcomeMessage: string;
  primaryColor: string;
  logoUrl?: string | null;
  iconUrl?: string | null;
  collectFeedback: boolean;
  embedToken: string;
};

type GuideMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  link?: { href: string; label: string };
};

const welcome: GuideMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi! I can explain how Docent crawls websites, grounds answers, or runs on your own server.",
};

function guideAnswer(question: string): Omit<GuideMessage, "id" | "role"> {
  if (/\b(?:price|pricing|cost|free)\b/i.test(question)) {
    return {
      content:
        "Docent is open-source and has no software license fee. You provide the server, PostgreSQL database, and model access.",
      link: { href: "#deploy", label: "See deployment details" },
    };
  }
  if (/\b(?:crawl\w*|website|sitemap|train\w*|source\w*)\b/i.test(question)) {
    return {
      content:
        "Add a public website URL and Docent checks robots.txt, discovers sitemaps and links, extracts useful text, then indexes it for cited retrieval.",
      link: { href: "#workflow", label: "See how training works" },
    };
  }
  if (/\b(?:hallucinat|ground|citation|reliable|source)\b/i.test(question)) {
    return {
      content:
        "Answers start from retrieved passages. Weak evidence triggers the fallback message, while supported answers retain clickable source citations.",
      link: { href: "#included", label: "Review included safeguards" },
    };
  }
  if (/\b(?:host|docker|vps|postgres|deploy)\b/i.test(question)) {
    return {
      content:
        "A small VPS can run the web app, worker, PostgreSQL, and pgvector with Docker. Keep the database on durable storage and back it up.",
      link: { href: "#open-source", label: "View the self-hosted stack" },
    };
  }
  return {
    content:
      "Docent turns websites and files into a branded support agent with citations, conversation review, feedback, and an embeddable widget.",
    link: { href: "/dashboard", label: "Build an agent" },
  };
}

function BuiltInGuide() {
  const [messages, setMessages] = useState<GuideMessage[]>([welcome]);
  const [value, setValue] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const question = value.trim();
    if (!question) return;
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: question },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        ...guideAnswer(question),
      },
    ]);
    setValue("");
  }

  return (
    <div className="chat-panel home-guide-panel">
      <header>
        <span className="chat-brand-avatar"><MessageCircle size={18} /></span>
        <span><b>Docent guide</b><small><i /> Online</small></span>
        <button
          aria-label="Reset conversation"
          onClick={() => setMessages([welcome])}
          type="button"
        >
          <RotateCcw size={15} />
        </button>
      </header>
      <div className="chat-messages" aria-live="polite">
        <div className="chat-date">Docent support</div>
        {messages.map((message) => (
          <div
            className={`chat-line chat-line-${message.role}`}
            key={message.id}
          >
            {message.role === "assistant" ? (
              <span className="chat-small-avatar">
                <MessageCircle size={12} />
              </span>
            ) : null}
            <div>
              <div className="chat-bubble">{message.content}</div>
              {message.link ? (
                <a className="home-guide-link" href={message.link.href}>
                  {message.link.label} <ExternalLink size={10} />
                </a>
              ) : null}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="chat-composer" onSubmit={submit}>
        <input
          aria-label="Ask Docent a question"
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          placeholder="Ask about Docent..."
          value={value}
        />
        <button aria-label="Send"><ArrowUp size={16} /></button>
      </form>
      <footer>Powered by <b>Docent</b></footer>
    </div>
  );
}

export function HomepageSupport({ agentId }: { agentId?: string }) {
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState<PublicAgent | null>(null);

  useEffect(() => {
    if (!agentId) return;
    const controller = new AbortController();
    fetch(`/api/public/agents/${encodeURIComponent(agentId)}`, {
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => setAgent(payload.data as PublicAgent))
      .catch(() => setAgent(null));
    return () => controller.abort();
  }, [agentId]);

  return (
    <aside className={`home-support-widget ${open ? "is-open" : ""}`}>
      <div
        className="home-support-panel"
        aria-hidden={!open}
        inert={!open}
      >
        {agent ? (
          <ChatPanel
            agentId={agent.id}
            collectFeedback={agent.collectFeedback}
            embedToken={agent.embedToken}
            iconUrl={agent.iconUrl}
            logoUrl={agent.logoUrl}
            name={agent.name}
            primaryColor={agent.primaryColor}
            welcomeMessage={agent.welcomeMessage}
          />
        ) : (
          <BuiltInGuide />
        )}
      </div>
      <button
        aria-expanded={open}
        aria-label={open ? "Close Docent support" : "Open Docent support"}
        className="home-support-launcher"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? <X size={23} /> : <MessageCircle size={23} />}
      </button>
    </aside>
  );
}
