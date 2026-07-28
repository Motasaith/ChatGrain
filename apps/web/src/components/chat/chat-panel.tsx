"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUp,
  ExternalLink,
  LoaderCircle,
  MessageCircle,
  RotateCcw,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  grounded?: boolean;
  citations?: Array<{
    chunkId: string;
    title: string;
    url?: string;
    excerpt: string;
  }>;
};

function sessionKey(agentId: string) {
  return `docent-session-${agentId}`;
}

function readableTextColor(hex: string) {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)
    ?.map((value) => Number.parseInt(value, 16));
  if (!channels || channels.length !== 3) return "#ffffff";
  const [red, green, blue] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.48
    ? "#15251d"
    : "#ffffff";
}

export function ChatPanel({
  agentId,
  welcomeMessage,
  name,
  primaryColor,
  logoUrl,
  iconUrl,
  embedded = false,
  collectFeedback = true,
  embedToken,
}: {
  agentId: string;
  welcomeMessage: string;
  name: string;
  primaryColor: string;
  logoUrl?: string | null;
  iconUrl?: string | null;
  embedded?: boolean;
  collectFeedback?: boolean;
  embedToken?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: welcomeMessage,
      grounded: true,
    },
  ]);
  const [conversationId, setConversationId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const volatileSessionRef = useRef<string | undefined>(undefined);
  const initializedRef = useRef(false);
  const brandImage = logoUrl || iconUrl;
  const contrastColor = readableTextColor(primaryColor);
  const panelStyle = {
    "--chat-accent": primaryColor,
    "--chat-accent-contrast": contrastColor,
  } as CSSProperties;

  function getSessionId() {
    try {
      const existing = window.sessionStorage.getItem(sessionKey(agentId));
      const value = existing || crypto.randomUUID();
      window.sessionStorage.setItem(sessionKey(agentId), value);
      return value;
    } catch {
      volatileSessionRef.current ??= crypto.randomUUID();
      return volatileSessionRef.current;
    }
  }

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    const element = messagesRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, busy]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const content = inputRef.current?.value.trim() ?? "";
    if (!content || busy) return;
    const sessionId = getSessionId();
    const localId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: localId, role: "user", content },
    ]);
    if (inputRef.current) inputRef.current.value = "";
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/chat/${agentId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: content,
          sessionId,
          conversationId,
          metadata: {
            path: window.location.pathname,
            referrer: document.referrer || undefined,
          },
          embedToken,
        }),
      });
      const payload = await response.json() as {
        data?: {
          conversationId: string;
          messageId: string;
          answer: string;
          grounded: boolean;
          citations: ChatMessage["citations"];
        };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || "The agent could not answer.");
      }
      setConversationId(payload.data.conversationId);
      setMessages((current) => [
        ...current,
        {
          id: payload.data!.messageId,
          role: "assistant",
          content: payload.data!.answer,
          grounded: payload.data!.grounded,
          citations: payload.data!.citations,
        },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send message.");
    } finally {
      setBusy(false);
    }
  }

  async function rate(messageId: string, rating: 1 | -1) {
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId, rating }),
    });
  }

  function reset() {
    const nextSession = crypto.randomUUID();
    try {
      window.sessionStorage.setItem(sessionKey(agentId), nextSession);
    } catch {
      volatileSessionRef.current = nextSession;
    }
    setConversationId(undefined);
    setMessages([{ id: "welcome", role: "assistant", content: welcomeMessage }]);
    setError("");
  }

  return (
    <div
      className={`chat-panel ${embedded ? "chat-panel-embedded" : ""}`}
      style={panelStyle}
    >
      <header>
        <span className="chat-brand-avatar">
          {brandImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" src={brandImage} />
          ) : <MessageCircle size={18} />}
        </span>
        <span><b>{name}</b><small><i /> Online</small></span>
        <button aria-label="Reset conversation" onClick={reset} type="button">
          <RotateCcw size={15} />
        </button>
      </header>
      <div className="chat-messages" aria-live="polite" ref={messagesRef}>
        <div className="chat-date">Today</div>
        {messages.map((message) => (
          <div className={`chat-line chat-line-${message.role}`} key={message.id}>
            {message.role === "assistant" && (
              <span className="chat-small-avatar">
                {brandImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={brandImage} />
                ) : (
                  <MessageCircle size={12} />
                )}
              </span>
            )}
            <div>
              <div className="chat-bubble">
                {message.content}
              </div>
              {message.role === "assistant" && message.citations?.length ? (
                <details className="chat-citations">
                  <summary>
                    <ShieldCheck size={11} />
                    {message.citations.length} verified source{message.citations.length === 1 ? "" : "s"}
                  </summary>
                  <div>
                    {message.citations.map((citation) => (
                      citation.url ? (
                        <a href={citation.url} key={citation.chunkId} rel="noreferrer" target="_blank">
                          <span><b>{citation.title}</b><small>{citation.excerpt}</small></span>
                          <ExternalLink size={11} />
                        </a>
                      ) : (
                        <span key={citation.chunkId}>
                          <span><b>{citation.title}</b><small>{citation.excerpt}</small></span>
                        </span>
                      )
                    ))}
                  </div>
                </details>
              ) : null}
              {collectFeedback && message.role === "assistant" && message.id !== "welcome" && (
                <div className="chat-rating">
                  <span>Helpful?</span>
                  <button aria-label="Helpful" onClick={() => rate(message.id, 1)} type="button"><ThumbsUp size={11} /></button>
                  <button aria-label="Not helpful" onClick={() => rate(message.id, -1)} type="button"><ThumbsDown size={11} /></button>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="chat-line chat-line-assistant">
            <span className="chat-small-avatar">
              {brandImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" src={brandImage} />
              ) : (
                <MessageCircle size={12} />
              )}
            </span>
            <div className="chat-bubble chat-thinking">
              <i /><i /><i />
            </div>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
      </div>
      <form className="chat-composer" onSubmit={send}>
        <input
          aria-label="Message"
          autoComplete="off"
          disabled={busy}
          placeholder="Ask a question..."
          ref={inputRef}
          type="text"
        />
        <button
          aria-label="Send"
          disabled={busy}
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <ArrowUp size={16} />}
        </button>
      </form>
      <footer>Powered by <b>Docent</b></footer>
    </div>
  );
}
