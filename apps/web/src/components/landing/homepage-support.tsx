"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, MessageCircle, X } from "lucide-react";
import { ChatPanel } from "@/components/chat/chat-panel";

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
};

function PreparingSupport() {
  return (
    <div className="chat-panel home-guide-panel">
      <header>
        <span className="chat-brand-avatar"><MessageCircle size={18} /></span>
        <span><b>Docent Support</b><small><i /> Preparing</small></span>
      </header>
      <div className="chat-messages" aria-live="polite">
        <div className="chat-date">Website knowledge</div>
        <div className="chat-line chat-line-assistant">
          <span className="chat-small-avatar">
            <LoaderCircle className="spin" size={12} />
          </span>
          <div>
            <div className="chat-bubble">
              I’m indexing the latest public Docent website content. Support
              chat will become available automatically when it is ready.
            </div>
          </div>
        </div>
      </div>
      <footer>Powered by <b>Docent</b></footer>
    </div>
  );
}

export function HomepageSupport({ agentId }: { agentId?: string }) {
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState<PublicAgent | null>(null);
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
            return;
          }
          throw new Error("Site agent is not ready.");
        }
        const payload = await response.json();
        setAgent(payload.data as PublicAgent);
      } catch {
        if (controller.signal.aborted) return;
        setAgent(null);
        retryTimer = setTimeout(loadAgent, 15_000);
      }
    }
    void loadAgent();
    return () => {
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [agentId]);

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
            welcomeMessage={agent.welcomeMessage}
          />
        ) : (
          <PreparingSupport />
        )}
      </div>
      <button
        aria-expanded={open}
        aria-label={
          open
            ? "Close Docent support"
            : unreadCount
              ? `Open Docent support, ${unreadCount} unread ${unreadCount === 1 ? "reply" : "replies"}`
              : "Open Docent support"
        }
        className={`home-support-launcher ${unreadCount ? "has-unread" : ""}`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? <X size={23} /> : <MessageCircle size={23} />}
        {!open && unreadCount ? (
          <span>{Math.min(unreadCount, 99)}</span>
        ) : null}
      </button>
    </aside>
  );
}
