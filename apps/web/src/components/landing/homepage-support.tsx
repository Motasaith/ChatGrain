"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, MessageCircle, X } from "lucide-react";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatGrainMark } from "@/components/logo";

type PublicAgent = {
  id: string;
  name: string;
  welcomeMessage: string;
  primaryColor: string;
  logoUrl?: string | null;
  iconUrl?: string | null;
  collectFeedback: boolean;
  showBranding: boolean;
  embedToken: string;
  teaserMessages: string[];
  attentionMessage: string;
  suggestedQuestions: string[];
};

/**
 * Why the assistant is not answering.
 *
 * Every failure used to render as "I am indexing", including a rejected domain
 * or a missing agent - states that never resolve. Claiming to be busy while
 * permanently broken is what makes it look like the widget "takes forever".
 */
type SupportState = "loading" | "indexing" | "unavailable" | "offline";

const SUPPORT_STATE_COPY: Record<
  Exclude<SupportState, "loading">,
  { status: string; message: string }
> = {
  indexing: {
    status: "Preparing",
    message:
      "I’m indexing the latest public ChatGrain website content. Support chat will become available automatically when it is ready.",
  },
  unavailable: {
    status: "Unavailable",
    message:
      "Support chat is not available on this site yet. Everything on this page is still here, and you can reach the team from the contact links.",
  },
  offline: {
    status: "Offline",
    message:
      "I could not reach the support service just now. Please refresh in a moment.",
  },
};

function PreparingSupport({ state }: { state: SupportState }) {
  const copy = SUPPORT_STATE_COPY[state === "loading" ? "indexing" : state];
  const busy = state === "loading" || state === "indexing";
  return (
    <div className="chat-panel home-guide-panel">
      <header>
        <span className="chat-brand-avatar"><ChatGrainMark size={18} /></span>
        <span><b>ChatGrain Support</b><small><i /> {copy.status}</small></span>
      </header>
      <div className="chat-messages" aria-live="polite">
        <div className="chat-date">Website knowledge</div>
        <div className="chat-line chat-line-assistant">
          <span className="chat-small-avatar">
            {busy ? (
              <LoaderCircle className="spin" size={12} />
            ) : (
              <MessageCircle size={12} />
            )}
          </span>
          <div>
            <div className="chat-bubble">{copy.message}</div>
          </div>
        </div>
      </div>
      <footer>Powered by <b>ChatGrain</b></footer>
    </div>
  );
}

export function HomepageSupport({ agentId }: { agentId?: string }) {
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState<PublicAgent | null>(null);
  const [supportState, setSupportState] = useState<SupportState>("loading");
  // Read lazily rather than in an effect. The prompts cannot render until the
  // agent loads (itself an effect), so the server and the first client render
  // both show nothing regardless of this value - no flash, no mismatch.
  const [promptsDismissed, setPromptsDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("chatgrain:prompts-dismissed") === "1";
    } catch {
      return false;
    }
  });
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    async function loadAgent() {
      const endpoint = agentId
        ? `/api/public/agents/${encodeURIComponent(agentId)}`
        : "/api/public/site-agent";
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          // A 4xx is a decision, not a hiccup: the agent is missing, paused, or
          // not permitted on this domain. Retrying every 15 seconds forever
          // just fills the console and the access log with the same rejection.
          if (response.status >= 400 && response.status < 500) {
            setAgent(null);
            setSupportState("unavailable");
            return;
          }
          // 503 is the one state that genuinely resolves on its own: the
          // worker is still building the site index.
          setSupportState("indexing");
          throw new Error("Site agent is not ready.");
        }
        const payload = await response.json();
        setAgent(payload.data as PublicAgent);
        setSupportState("loading");
      } catch {
        if (controller.signal.aborted) return;
        setAgent(null);
        setSupportState((current) =>
          current === "indexing" ? "indexing" : "offline",
        );
        retryTimer = setTimeout(loadAgent, 15_000);
      }
    }
    void loadAgent();
    return () => {
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [agentId]);

  function dismissPrompts() {
    setPromptsDismissed(true);
    try {
      window.localStorage.setItem("chatgrain:prompts-dismissed", "1");
    } catch {
      // A blocked store only costs the preference, not the dismissal.
    }
  }

  useEffect(() => {
    function receiveUnread(event: MessageEvent) {
      if (
        event.source !== window ||
        event.data?.type !== "docent:unread" ||
        (agent?.id && event.data.agentId !== agent.id)
      ) {
        return;
      }
      setUnreadCount(Math.max(0, Number(event.data.count) || 0));
    }
    window.addEventListener("message", receiveUnread);
    return () => window.removeEventListener("message", receiveUnread);
  }, [agent?.id]);

  return (
    <aside className={`home-support-widget ${open ? "is-open" : ""}`}>
      <div
        className="home-support-panel"
        aria-hidden={!open}
        inert={!open}
      >
        {agent ? (
          <ChatPanel
            active={open}
            agentId={agent.id}
            collectFeedback={agent.collectFeedback}
            embedToken={agent.embedToken}
            iconUrl={agent.iconUrl}
            logoUrl={agent.logoUrl}
            name={agent.name}
            primaryColor={agent.primaryColor}
            showBranding={agent.showBranding}
            suggestedQuestions={agent.suggestedQuestions}
            welcomeMessage={agent.welcomeMessage}
          />
        ) : (
          <PreparingSupport state={supportState} />
        )}
      </div>
      {/* The embedded widget has shown teasers and an attention pill since it
          shipped; the homepage ran a different shell without them, so ChatGrain
          was demonstrating a lesser widget than the one it hands out. */}
      {!open && !promptsDismissed && agent?.teaserMessages?.length ? (
        <div className="home-support-teasers">
          <button
            aria-label="Dismiss chat suggestions"
            className="home-support-dismiss"
            onClick={dismissPrompts}
            title="Dismiss these messages"
            type="button"
          >
            <X size={14} />
          </button>
          {agent.teaserMessages.slice(0, 3).map((message) => (
            <button key={message} onClick={() => setOpen(true)} type="button">
              {message}
            </button>
          ))}
        </div>
      ) : null}
      {!open && !promptsDismissed && agent?.attentionMessage ? (
        <span className="home-support-attention" aria-hidden>
          <i />
          {agent.attentionMessage}
        </span>
      ) : null}
      <button
        aria-expanded={open}
        aria-label={
          open
            ? "Close ChatGrain support"
            : unreadCount
              ? `Open ChatGrain support, ${unreadCount} unread ${unreadCount === 1 ? "reply" : "replies"}`
              : "Open ChatGrain support"
        }
        className={`home-support-launcher ${unreadCount ? "has-unread" : ""}`}
        onClick={() => setOpen((value) => !value)}
        title={open ? "Close ChatGrain support" : "Ask ChatGrain support"}
        type="button"
      >
        {open ? <X size={23} /> : <ChatGrainMark size={24} />}
        {!open && unreadCount ? (
          <span>{Math.min(unreadCount, 99)}</span>
        ) : null}
      </button>
    </aside>
  );
}
