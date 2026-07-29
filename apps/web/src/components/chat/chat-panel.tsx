"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  MessageCircle,
  RotateCcw,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import type { ChatUiAction } from "@/lib/chat/answer";

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
  action?: ChatUiAction;
};

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function InlineMarkdown({ content }: { content: string }) {
  const pattern =
    /\[([^\]\n]{1,240})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\*([^*\n]+)\*/gi;
  const output: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    if (match.index > cursor) {
      output.push(content.slice(cursor, match.index));
    }
    const rawUrl = match[2] || match[3] || "";
    const trailing =
      match[3]?.match(/[.,!?;:]+$/)?.[0] ?? "";
    const linkValue = trailing
      ? rawUrl.slice(0, -trailing.length)
      : rawUrl;
    const href = rawUrl ? safeHttpUrl(linkValue) : null;
    if (href) {
      output.push(
        <a
          href={href}
          key={`${match.index}-${href}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {match[1] || linkValue}
          <ExternalLink aria-hidden="true" size={10} />
        </a>,
      );
      if (trailing) output.push(trailing);
    } else if (match[4] || match[5]) {
      output.push(
        <strong key={`strong-${match.index}`}>
          {match[4] || match[5]}
        </strong>,
      );
    } else if (match[6]) {
      output.push(<code key={`code-${match.index}`}>{match[6]}</code>);
    } else if (match[7]) {
      output.push(<em key={`em-${match.index}`}>{match[7]}</em>);
    } else {
      output.push(match[0]);
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < content.length) output.push(content.slice(cursor));
  return output;
}

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const items: string[] = [];
      const orderedList = Boolean(ordered);
      while (index < lines.length) {
        const match = orderedList
          ? lines[index].match(/^\s*\d+[.)]\s+(.+)$/)
          : lines[index].match(/^\s*[-*]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      const children = items.map((item, itemIndex) => (
        <li key={itemIndex}><InlineMarkdown content={item} /></li>
      ));
      blocks.push(
        orderedList
          ? <ol key={`ol-${index}`}>{children}</ol>
          : <ul key={`ul-${index}`}>{children}</ul>,
      );
      continue;
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      blocks.push(
        <strong className="chat-markdown-heading" key={`h-${index}`}>
          <InlineMarkdown content={heading[1]} />
        </strong>,
      );
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*(?:[-*]\s+|\d+[.)]\s+|#{1,3}\s+)/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={`p-${index}`}>
        {paragraph.map((item, lineIndex) => (
          <span key={lineIndex}>
            {lineIndex > 0 ? <br /> : null}
            <InlineMarkdown content={item} />
          </span>
        ))}
      </p>,
    );
  }
  return blocks;
}

function LeadCapture({
  action,
  agentId,
  conversationId,
  requestText,
  getSessionId,
  embedToken,
}: {
  action: ChatUiAction;
  agentId: string;
  conversationId?: string;
  requestText: string;
  getSessionId: () => string;
  embedToken?: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState(requestText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() && !phone.trim()) {
      setError("Add an email address or phone number.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId,
          conversationId,
          sessionId: getSessionId(),
          embedToken,
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          data: {
            request: note.trim() || requestText,
            source: "human_handoff",
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload.error?.message || "Could not submit your request.",
        );
      }
      setSubmitted(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not submit your request.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="chat-lead-success">
        <CheckCircle2 size={15} />
        <span><b>Request sent</b><small>The website team can now follow up from their Docent inbox.</small></span>
      </div>
    );
  }

  return (
    <form className="chat-lead-form" onSubmit={submit}>
      <div>
        <b>{action.title}</b>
        <small>{action.description}</small>
      </div>
      <input
        aria-label="Your name"
        maxLength={120}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name (optional)"
        value={name}
      />
      <input
        aria-label="Email address"
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Email address"
        type="email"
        value={email}
      />
      <input
        aria-label="Phone number"
        maxLength={40}
        onChange={(event) => setPhone(event.target.value)}
        placeholder="Phone number"
        type="tel"
        value={phone}
      />
      <textarea
        aria-label="How can the team help?"
        maxLength={1_000}
        onChange={(event) => setNote(event.target.value)}
        placeholder="How can the team help?"
        rows={3}
        value={note}
      />
      {error ? <span className="chat-lead-error">{error}</span> : null}
      <button disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={13} /> : null}
        {busy ? "Sending…" : action.submitLabel}
      </button>
    </form>
  );
}

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
  showBranding = true,
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
  showBranding?: boolean;
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusGuardUntilRef = useRef(0);
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

  function restoreComposerFocus() {
    const field = inputRef.current;
    if (
      !field ||
      field.disabled ||
      Date.now() > focusGuardUntilRef.current
    ) {
      return;
    }
    if (document.activeElement !== field) {
      field.focus({ preventScroll: true });
    }
  }

  function guardComposerFocus() {
    focusGuardUntilRef.current = Date.now() + 500;
    window.requestAnimationFrame(restoreComposerFocus);
    window.setTimeout(restoreComposerFocus, 60);
    window.setTimeout(restoreComposerFocus, 180);
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

  useEffect(() => {
    function focusFromEmbed(event: MessageEvent) {
      if (
        event.source !== window.parent ||
        event.data?.type !== "docent:focus-composer"
      ) {
        return;
      }
      const field = inputRef.current;
      if (!field || field.disabled) return;
      focusGuardUntilRef.current = Date.now() + 500;
      field.focus({ preventScroll: true });
    }
    window.addEventListener("message", focusFromEmbed);
    return () => window.removeEventListener("message", focusFromEmbed);
  }, []);

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
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.style.height = "";
    }
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
          action?: ChatUiAction;
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
          action: payload.data!.action,
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
        {messages.map((message, messageIndex) => (
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
                {message.role === "assistant" ? (
                  <MarkdownMessage content={message.content} />
                ) : (
                  message.content
                )}
              </div>
              {message.role === "assistant" && message.citations?.length ? (
                <details className="chat-citations">
                  <summary>
                    <ShieldCheck size={11} />
                    {message.citations.length} source{message.citations.length === 1 ? "" : "s"} used
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
              {message.role === "assistant" && message.action ? (
                <LeadCapture
                  action={message.action}
                  agentId={agentId}
                  conversationId={conversationId}
                  embedToken={embedToken}
                  getSessionId={getSessionId}
                  requestText={
                    [...messages]
                      .slice(0, messageIndex)
                      .reverse()
                      .find((item) => item.role === "user")
                      ?.content ?? ""
                  }
                />
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
        <textarea
          aria-label="Message"
          autoComplete="off"
          disabled={busy}
          onBlur={restoreComposerFocus}
          onInput={(event) => {
            const field = event.currentTarget;
            field.style.height = "auto";
            field.style.height = `${Math.min(field.scrollHeight, 104)}px`;
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onPointerDown={guardComposerFocus}
          placeholder="Ask a question..."
          ref={inputRef}
          rows={1}
        />
        <button
          aria-label="Send"
          disabled={busy}
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <ArrowUp size={16} />}
        </button>
      </form>
      {showBranding ? <footer>Powered by <b>Docent</b></footer> : null}
    </div>
  );
}
