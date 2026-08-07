"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUp,
  Bell,
  CheckCircle2,
  ExternalLink,
  History,
  ImagePlus,
  LifeBuoy,
  LoaderCircle,
  MessageCircle,
  Mic,
  Phone,
  Plus,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  TicketCheck,
  Trash2,
  X,
} from "lucide-react";
import type { ChatUiAction } from "@/lib/chat/answer";
import { VoiceCallOverlay, type CallTurn } from "@/components/chat/voice-call";
import {
  VoiceNotePlayer,
  VoiceNoteRecorder,
} from "@/components/chat/voice-note";
import type { StartCallOptions } from "@/lib/voice/client/call";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "operator" | "system";
  content: string;
  createdAt?: string;
  grounded?: boolean;
  citations?: Array<{
    chunkId: string;
    title: string;
    url?: string;
    excerpt: string;
  }>;
  action?: ChatUiAction;
  attachments?: ChatAttachment[];
};

type ChatAttachment = {
  id: string;
  kind: "image" | "audio" | "file";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
  transcript?: string | null;
};

type ConversationSummary = {
  id: string;
  sessionId: string;
  title: string;
  status: string;
  lastMessageAt: string;
  lastMessage: string;
  lastMessageRole?: string;
  unreadCount: number;
  ticket?: {
    reference: string;
    status: string;
    priority: string;
  } | null;
};

/**
 * How close to the bottom the transcript must be for new messages to scroll it.
 * Generous enough to absorb a partially visible last line.
 */
const AUTO_SCROLL_THRESHOLD_PX = 120;

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A voice note carries its transcript as the message body so the agent can
 * answer what was said, but the visitor should see the player alone - the
 * transcript is machine input, not something they typed.
 *
 * Checked against the attachment rather than a local flag so notes reloaded
 * from conversation history render the same way.
 */
function isVoiceNoteMessage(message: ChatMessage) {
  return (
    message.role === "user" &&
    Boolean(message.attachments?.some((item) => item.kind === "audio"))
  );
}

/**
 * Collapses repeated sources. A chunk can legitimately be cited twice while an
 * answer is assembled, and rendering both breaks React's key uniqueness as well
 * as showing the reader the same source twice.
 */
function uniqueCitations<T extends { chunkId: string }>(citations: T[]) {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    if (seen.has(citation.chunkId)) return false;
    seen.add(citation.chunkId);
    return true;
  });
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
  onSubmitted,
}: {
  action: ChatUiAction;
  agentId: string;
  conversationId?: string;
  requestText: string;
  getSessionId: () => string;
  embedToken?: string;
  onSubmitted?: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState(requestText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [ticketReference, setTicketReference] = useState("");

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
      setTicketReference(payload.data?.ticket?.reference || "");
      setSubmitted(true);
      onSubmitted?.();
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
        <span>
          <b>
            Request sent
            {ticketReference ? ` · ${ticketReference}` : ""}
          </b>
          <small>
            Keep this chat in your history. New replies from the website team
            will appear here.
          </small>
        </span>
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

function visitorKey(agentId: string) {
  return `docent-visitor-${agentId}`;
}

function activeConversationKey(agentId: string) {
  return `docent-active-conversation-${agentId}`;
}

function readLocalValue(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalValue(key: string, value?: string) {
  try {
    if (value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // The widget still works for the current page when storage is blocked.
  }
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
  suggestedQuestions = [],
  name,
  primaryColor,
  logoUrl,
  iconUrl,
  embedded = false,
  collectFeedback = true,
  helpCenterEnabled = true,
  helpCenterGreeting = "How can we help?",
  showBranding = true,
  embedToken,
  active,
}: {
  agentId: string;
  welcomeMessage: string;
  name: string;
  primaryColor: string;
  logoUrl?: string | null;
  iconUrl?: string | null;
  embedded?: boolean;
  collectFeedback?: boolean;
  helpCenterEnabled?: boolean;
  helpCenterGreeting?: string;
  showBranding?: boolean;
  embedToken?: string;
  active?: boolean;
  suggestedQuestions?: string[];
}) {
  const welcome = {
    id: "welcome",
    role: "assistant" as const,
    content: welcomeMessage,
    grounded: true,
  };
  const [messages, setMessages] = useState<ChatMessage[]>([
    welcome,
  ]);
  const [visitorId, setVisitorId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpCenterOpen, setHelpCenterOpen] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<
    ChatAttachment[]
  >([]);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [callOptions, setCallOptions] = useState<StartCallOptions>();
  const [notice, setNotice] = useState("");
  const [embeddedActive, setEmbeddedActive] = useState(!embedded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const focusGuardUntilRef = useRef(0);
  const initializedRef = useRef(false);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const sessionIdRef = useRef("");
  const visitorIdRef = useRef("");
  const previousUnreadRef = useRef(-1);
  const activeRef = useRef(active ?? !embedded);
  const brandImage = logoUrl || iconUrl;
  const contrastColor = readableTextColor(primaryColor);
  const panelStyle = {
    "--chat-accent": primaryColor,
    "--chat-accent-contrast": contrastColor,
  } as CSSProperties;
  const isActive = active ?? embeddedActive;

  function authorizationHeaders(): Record<string, string> {
    return embedToken ? { authorization: `Bearer ${embedToken}` } : {};
  }

  function activateConversation(id: string | undefined, session: string) {
    conversationIdRef.current = id;
    sessionIdRef.current = session;
    setConversationId(id);
    setSessionId(session);
    if (id) {
      writeLocalValue(
        activeConversationKey(agentId),
        JSON.stringify({ id, sessionId: session }),
      );
    } else {
      writeLocalValue(activeConversationKey(agentId));
    }
  }

  function getSessionId() {
    return sessionIdRef.current || sessionId || crypto.randomUUID();
  }

  function attachmentUrl(
    attachmentId: string,
    targetConversationId = conversationId,
    targetSessionId = sessionId,
  ) {
    if (!targetConversationId) return "";
    const query = new URLSearchParams({
      visitorId,
      sessionId: targetSessionId,
      ...(embedToken ? { token: embedToken } : {}),
    });
    return `/api/public/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(targetConversationId)}/attachments/${encodeURIComponent(attachmentId)}?${query}`;
  }

  function playReplyAlert() {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 720;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.2);
      window.setTimeout(() => void context.close(), 350);
    } catch {
      // Unread badges still work when a browser blocks background audio.
    }
  }

  function publishUnread(count: number) {
    try {
      window.parent.postMessage(
        { type: "docent:unread", agentId, count },
        "*",
      );
    } catch {
      // The standalone widget has no parent integration.
    }
    if (
      previousUnreadRef.current >= 0 &&
      count > previousUnreadRef.current
    ) {
      playReplyAlert();
    }
    previousUnreadRef.current = count;
    setUnreadCount(count);
  }

  async function refreshHistory(targetVisitorId = visitorIdRef.current) {
    if (!targetVisitorId) return [];
    const query = new URLSearchParams({ visitorId: targetVisitorId });
    const response = await fetch(
      `/api/public/agents/${encodeURIComponent(agentId)}/conversations?${query}`,
      {
        cache: "no-store",
        headers: authorizationHeaders(),
      },
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      data?: { conversations?: ConversationSummary[] };
    };
    const rows = payload.data?.conversations ?? [];
    setConversations(rows);
    publishUnread(
      rows.reduce((total, conversation) => total + conversation.unreadCount, 0),
    );
    return rows;
  }

  async function markConversationRead(
    id = conversationIdRef.current,
    targetSessionId = sessionIdRef.current,
  ) {
    if (!id || !visitorIdRef.current || document.visibilityState === "hidden") {
      return;
    }
    await fetch(
      `/api/public/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...authorizationHeaders(),
        },
        body: JSON.stringify({
          visitorId: visitorIdRef.current,
          sessionId: targetSessionId,
        }),
      },
    ).catch(() => undefined);
  }

  async function loadConversation(
    summary: Pick<ConversationSummary, "id" | "sessionId">,
    {
      markRead = true,
      preservePending = false,
    }: { markRead?: boolean; preservePending?: boolean } = {},
  ) {
    const query = new URLSearchParams({
      visitorId: visitorIdRef.current,
      sessionId: summary.sessionId,
    });
    const response = await fetch(
      `/api/public/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(summary.id)}?${query}`,
      {
        cache: "no-store",
        headers: authorizationHeaders(),
      },
    );
    if (!response.ok) return false;
    const payload = (await response.json()) as {
      data?: {
        messages?: ChatMessage[];
      };
    };
    const history = (payload.data?.messages ?? []).filter(
      (message) =>
        message.role === "user" ||
        message.role === "assistant" ||
        message.role === "operator" ||
        message.role === "system",
    );
    activateConversation(summary.id, summary.sessionId);
    setMessages(history.length ? history : [welcome]);
    if (!preservePending) setPendingAttachments([]);
    setNotice("");
    if (markRead) {
      await markConversationRead(summary.id, summary.sessionId);
    }
    return true;
  }

  async function ensureConversation() {
    if (conversationIdRef.current) {
      return {
        id: conversationIdRef.current,
        sessionId: sessionIdRef.current,
      };
    }
    const nextSession = sessionIdRef.current || crypto.randomUUID();
    const response = await fetch(
      `/api/public/agents/${encodeURIComponent(agentId)}/conversations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          visitorId: visitorIdRef.current,
          sessionId: nextSession,
          embedToken,
          metadata: {
            path: window.location.pathname,
            referrer: document.referrer || undefined,
          },
        }),
      },
    );
    const payload = (await response.json()) as {
      data?: { id: string; sessionId: string };
      error?: { message?: string };
    };
    if (!response.ok || !payload.data) {
      throw new Error(
        payload.error?.message || "Could not start a conversation.",
      );
    }
    activateConversation(payload.data.id, payload.data.sessionId);
    return payload.data;
  }

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      const storedVisitor =
        readLocalValue(visitorKey(agentId)) || crypto.randomUUID();
      writeLocalValue(visitorKey(agentId), storedVisitor);
      visitorIdRef.current = storedVisitor;
      setVisitorId(storedVisitor);
      const nextSession = crypto.randomUUID();
      sessionIdRef.current = nextSession;
      setSessionId(nextSession);
      const rows = await refreshHistory(storedVisitor);
      if (cancelled) return;
      const storedActive = readLocalValue(activeConversationKey(agentId));
      let active:
        | { id: string; sessionId: string }
        | undefined;
      try {
        active = storedActive ? JSON.parse(storedActive) : undefined;
      } catch {
        active = undefined;
      }
      const selected =
        (active &&
          rows.find(
            (conversation) =>
              conversation.id === active?.id &&
              conversation.sessionId === active.sessionId,
          )) ||
        rows[0];
      if (selected) {
        await loadConversation(selected, { markRead: activeRef.current });
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
    // The public agent identity changes only when the widget is re-created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, embedToken]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const rows = await refreshHistory();
      const active = rows.find(
        (conversation) => conversation.id === conversationIdRef.current,
      );
      if (active) {
        await loadConversation(active, {
          markRead:
            activeRef.current && document.visibilityState !== "hidden",
          preservePending: true,
        });
      }
    }, 10_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, embedToken]);

  useEffect(() => {
    activeRef.current = isActive;
    if (isActive) {
      void markConversationRead().then(() => refreshHistory());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (embedded && window.self === window.top) {
        setEmbeddedActive(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [embedded]);

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
    if (!element) return;
    // Only follow new content when the visitor is already at the bottom.
    // Background polling used to re-run this on every refresh and yank the
    // transcript down while they were reading earlier messages.
    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, busy, pendingAttachments]);

  useEffect(() => {
    function focusFromEmbed(event: MessageEvent) {
      if (event.source !== window.parent) return;
      if (event.data?.type === "docent:visibility") {
        setEmbeddedActive(Boolean(event.data.open));
        return;
      }
      if (event.data?.type !== "docent:focus-composer") return;
      setEmbeddedActive(true);
      const field = inputRef.current;
      if (!field || field.disabled) return;
      focusGuardUntilRef.current = Date.now() + 500;
      field.focus({ preventScroll: true });
    }
    window.addEventListener("message", focusFromEmbed);
    return () => window.removeEventListener("message", focusFromEmbed);
  }, []);

  async function uploadAttachment(
    file: File,
    kind: "image" | "audio",
    transcript?: string,
    durationMs?: number,
  ) {
    setUploading(true);
    setError("");
    try {
      const conversation = await ensureConversation();
      const form = new FormData();
      form.append("visitorId", visitorIdRef.current);
      form.append("sessionId", conversation.sessionId);
      if (embedToken) form.append("embedToken", embedToken);
      form.append("kind", kind);
      form.append("file", file);
      if (transcript?.trim()) form.append("transcript", transcript.trim());
      if (durationMs) form.append("durationMs", String(durationMs));
      const response = await fetch(
        `/api/public/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(conversation.id)}/attachments`,
        { method: "POST", body: form },
      );
      const payload = (await response.json()) as {
        data?: ChatAttachment;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || "Could not upload attachment.");
      }
      setPendingAttachments((current) => [...current, payload.data!]);
      // Voice notes post on their own; only an image waits in the composer for
      // the visitor to add a question alongside it.
      if (kind === "image" && payload.data.transcript && inputRef.current) {
        inputRef.current.value = [
          inputRef.current.value.trim(),
          payload.data.transcript,
        ]
          .filter(Boolean)
          .join(" ");
        inputRef.current.style.height = "auto";
        inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 104)}px`;
      }
      return payload.data;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not upload attachment.",
      );
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function removePendingAttachment(attachment: ChatAttachment) {
    setPendingAttachments((current) =>
      current.filter((item) => item.id !== attachment.id),
    );
    const url = attachmentUrl(attachment.id);
    if (url) {
      await fetch(url, { method: "DELETE" }).catch(() => undefined);
    }
  }

  async function chooseImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await uploadAttachment(file, "image");
  }

  async function openVoiceCall() {
    setError("");
    setNotice("");
    try {
      // Resolved before the overlay mounts so the call joins the conversation
      // already on screen instead of starting a detached one.
      const conversation = await ensureConversation();
      setCallOptions({
        agentId,
        sessionId: conversation.sessionId,
        conversationId: conversation.id,
        externalUserId: visitorIdRef.current || undefined,
        embedToken,
        locale: navigator.language,
        path: window.location.pathname,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start a voice call.",
      );
    }
  }

  function closeVoiceCall(callTurns: CallTurn[]) {
    setCallOptions(undefined);
    if (!callTurns.length) return;
    // Fold the call into the visible thread; the gateway already persisted
    // these turns, so this only catches the UI up.
    setMessages((current) => [
      ...current.filter(
        (message) => message.id !== "welcome" || current.length === 1,
      ),
      ...callTurns.map((turn) => ({
        id: `voice-${turn.id}`,
        role: turn.role,
        content: turn.text,
        citations: turn.citations,
        grounded: true,
      })),
    ]);
  }

  /**
   * Uploads a finished voice note and posts it as its own message.
   *
   * The server transcript becomes the message text so the agent answers what
   * was actually said; without a transcription service the note still reaches
   * a human operator.
   */
  async function sendVoiceNote(file: File, durationMs: number) {
    setRecording(false);
    setError("");
    setNotice("");
    const attachment = await uploadAttachment(file, "audio", "", durationMs);
    if (!attachment) return;
    setPendingAttachments([]);
    await deliver(
      attachment.transcript?.trim() ||
        "I want the support team to review my attached voice message.",
      [attachment],
    );
  }

  /** Sends a starter chip as if the visitor had typed it. */
  async function askSuggested(question: string) {
    if (busy || uploading) return;
    await deliver(question, []);
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const typed = inputRef.current?.value.trim() ?? "";
    const content =
      typed ||
      (pendingAttachments.some((attachment) => attachment.kind === "image")
        ? "Please analyze the attached image in relation to my question."
        : pendingAttachments.some((attachment) => attachment.kind === "audio")
          ? "I want the support team to review my attached voice message."
          : "");
    if (!content || busy || uploading) return;
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.style.height = "";
    }
    await deliver(content, pendingAttachments);
  }

  /**
   * Sends one visitor turn and appends the answer.
   *
   * Shared by the composer and by voice notes, which post immediately on
   * release instead of being staged as a pending attachment.
   */
  async function deliver(content: string, attachments: ChatAttachment[]) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const conversation = await ensureConversation();
      const localAttachments = attachments;
      const localId = crypto.randomUUID();
      setMessages((current) => [
        ...current.filter((message) => message.id !== "welcome" || current.length === 1),
        {
          id: localId,
          role: "user",
          content,
          attachments: localAttachments,
        },
      ]);
      setPendingAttachments([]);
      const response = await fetch(`/api/chat/${agentId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: content,
          sessionId: conversation.sessionId,
          conversationId: conversation.id,
          externalUserId: visitorIdRef.current,
          attachmentIds: localAttachments.map((attachment) => attachment.id),
          metadata: {
            path: window.location.pathname,
            referrer: document.referrer || undefined,
          },
          embedToken,
        }),
      });
      const payload = (await response.json()) as {
        data?: {
          conversationId: string;
          messageId: string;
          answer: string;
          grounded: boolean;
          citations: ChatMessage["citations"];
          action?: ChatUiAction;
          queuedForOperator?: boolean;
        };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || "The agent could not answer.");
      }
      if (payload.data.queuedForOperator) {
        setNotice("Message sent to the support team.");
      } else if (payload.data.answer) {
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
      }
      await markConversationRead(conversation.id, conversation.sessionId);
      await refreshHistory();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not send message.",
      );
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

  function startNewConversation() {
    const nextSession = crypto.randomUUID();
    activateConversation(undefined, nextSession);
    setMessages([welcome]);
    setPendingAttachments([]);
    setHistoryOpen(false);
    setHelpCenterOpen(false);
    setNotice("");
    setError("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function selectConversation(conversation: ConversationSummary) {
    setHistoryOpen(false);
    setHelpCenterOpen(false);
    await loadConversation(conversation);
    await refreshHistory();
  }

  function prepareNewConversation(message = "") {
    startNewConversation();
    window.setTimeout(() => {
      const field = inputRef.current;
      if (!field) return;
      field.value = message;
      field.style.height = message ? `${Math.min(field.scrollHeight, 104)}px` : "";
      field.focus({ preventScroll: true });
    }, 0);
  }

  async function deleteConversation(conversation: ConversationSummary) {
    if (
      !window.confirm(
        `Delete “${conversation.title}”? This permanently removes its messages and attachments.`,
      )
    ) {
      return;
    }
    setDeletingConversationId(conversation.id);
    setHistoryError("");
    try {
      const response = await fetch(
        `/api/public/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(conversation.id)}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            ...authorizationHeaders(),
          },
          body: JSON.stringify({
            visitorId: visitorIdRef.current,
            sessionId: conversation.sessionId,
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.error?.message || "Could not delete this conversation.",
        );
      }
      if (conversation.id === conversationIdRef.current) {
        startNewConversation();
        setHistoryOpen(true);
      }
      await refreshHistory();
    } catch (cause) {
      setHistoryError(
        cause instanceof Error
          ? cause.message
          : "Could not delete this conversation.",
      );
    } finally {
      setDeletingConversationId("");
    }
  }

  const activeTicket = conversations.find(
    (conversation) => conversation.id === conversationId,
  )?.ticket;
  const ticketConversations = conversations.filter(
    (conversation) => conversation.ticket,
  );

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
        <span className="chat-header-actions">
          {helpCenterEnabled ? (
            <button
              aria-label="Help center"
              className={helpCenterOpen ? "active" : ""}
              title="Help center"
              onClick={() => {
                setHistoryOpen(false);
                setHelpCenterOpen((current) => !current);
              }}
              type="button"
            >
              <LifeBuoy size={16} />
            </button>
          ) : null}
          <button
            aria-label="Conversation history"
            className={unreadCount ? "has-unread" : ""}
            title="Your past conversations"
            onClick={() => {
              setHelpCenterOpen(false);
              setHistoryOpen((current) => !current);
            }}
            type="button"
          >
            <History size={16} />
            {unreadCount ? <em>{Math.min(unreadCount, 99)}</em> : null}
          </button>
          <button
            aria-label="Start a new conversation"
            onClick={startNewConversation}
            title="Start a new conversation"
            type="button"
          >
            <Plus size={17} />
          </button>
        </span>
      </header>
      {helpCenterEnabled && helpCenterOpen ? (
        <section className="chat-help-panel">
          <div className="chat-help-heading">
            <span>
              <LifeBuoy size={15} />
              <b>Help center</b>
            </span>
            <button
              aria-label="Close help center"
              title="Close help center"
              onClick={() => setHelpCenterOpen(false)}
              type="button"
            >
              <X size={16} />
            </button>
          </div>
          <div className="chat-help-intro">
            <span><LifeBuoy size={19} /></span>
            <div>
              <h2>{helpCenterGreeting}</h2>
              <p>Ask the assistant now or continue a request with the support team.</p>
            </div>
          </div>
          <div className="chat-help-actions">
            <button
              onClick={() => prepareNewConversation()}
              type="button"
            >
              <MessageCircle size={17} />
              <span>
                <b>Ask a question</b>
                <small>Get an answer from the website knowledge base.</small>
              </span>
            </button>
            <button
              onClick={() =>
                prepareNewConversation("I would like to contact the support team.")
              }
              type="button"
            >
              <TicketCheck size={17} />
              <span>
                <b>Contact support</b>
                <small>Send a request and receive replies in this widget.</small>
              </span>
            </button>
          </div>
          <div className="chat-help-tickets">
            <span>
              <b>Your support tickets</b>
              <small>{ticketConversations.length}</small>
            </span>
            {ticketConversations.length ? (
              ticketConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => void selectConversation(conversation)}
                  type="button"
                >
                  <TicketCheck size={15} />
                  <span>
                    <b>{conversation.ticket?.reference}</b>
                    <small>{conversation.title}</small>
                  </span>
                  <i>{conversation.ticket?.status.replaceAll("_", " ")}</i>
                  {conversation.unreadCount ? (
                    <em>{conversation.unreadCount}</em>
                  ) : null}
                </button>
              ))
            ) : (
              <p>
                No tickets yet. Contact support above when you need a person.
              </p>
            )}
          </div>
        </section>
      ) : null}
      {historyOpen ? (
        <section className="chat-history-panel">
          <div>
            <span>
              <History size={15} />
              <b>Your conversations</b>
            </span>
            <button
              aria-label="Close conversation history"
              title="Close conversation history"
              onClick={() => setHistoryOpen(false)}
              type="button"
            >
              <X size={16} />
            </button>
          </div>
          <button
            className="chat-new-conversation"
            onClick={startNewConversation}
            type="button"
          >
            <Plus size={15} /> Start a new chat
          </button>
          <div className="chat-history-list">
            {conversations.length ? (
              conversations.map((conversation) => (
                <div
                  className={`chat-history-item ${
                    conversation.id === conversationId ? "active" : ""
                  }`}
                  key={conversation.id}
                >
                  <button
                    className="chat-history-select"
                    onClick={() => void selectConversation(conversation)}
                    type="button"
                  >
                    <span>
                      <b>{conversation.title}</b>
                      <small>
                        {conversation.lastMessage || "No messages yet"}
                      </small>
                    </span>
                    <span>
                      {conversation.ticket ? (
                        <i>{conversation.ticket.reference}</i>
                      ) : null}
                      {conversation.unreadCount ? (
                        <em>{conversation.unreadCount}</em>
                      ) : null}
                    </span>
                  </button>
                  <button
                    aria-label={`Delete ${conversation.title}`}
                    className="chat-history-delete"
                    disabled={deletingConversationId === conversation.id}
                    onClick={() => void deleteConversation(conversation)}
                    title="Delete conversation"
                    type="button"
                  >
                    {deletingConversationId === conversation.id ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
              ))
            ) : (
              <p>No previous conversations yet.</p>
            )}
          </div>
          {historyError ? (
            <p className="chat-history-error">{historyError}</p>
          ) : null}
        </section>
      ) : null}
      <div className="chat-messages" aria-live="polite" ref={messagesRef}>
        <div className="chat-date">Today</div>
        {activeTicket ? (
          <div className="chat-ticket-banner">
            <Bell size={12} />
            <span>
              <b>{activeTicket.reference}</b>
              <small>{activeTicket.status.replaceAll("_", " ")}</small>
            </span>
          </div>
        ) : null}
        {messages.map((message, messageIndex) => {
          if (message.role === "system") {
            return (
              <div className="chat-system-event" key={message.id}>
                {message.content}
              </div>
            );
          }
          const fromTeam =
            message.role === "assistant" || message.role === "operator";
          return (
            <div
              className={`chat-line chat-line-${fromTeam ? "assistant" : "user"} ${message.role === "operator" ? "chat-line-operator" : ""}`}
              key={message.id}
            >
              {fromTeam ? (
                <span className="chat-small-avatar">
                  {brandImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={brandImage} />
                  ) : (
                    <MessageCircle size={12} />
                  )}
                </span>
              ) : null}
              <div>
                {message.role === "operator" ? (
                  <span className="chat-operator-label">Support team</span>
                ) : null}
                <div className="chat-bubble">
                  {fromTeam ? (
                    <MarkdownMessage content={message.content} />
                  ) : isVoiceNoteMessage(message) ? null : (
                    message.content
                  )}
                  {message.attachments?.length ? (
                    <div className="chat-message-attachments">
                      {message.attachments.map((attachment) =>
                        attachment.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={attachment.fileName}
                            key={attachment.id}
                            loading="lazy"
                            src={attachmentUrl(attachment.id)}
                          />
                        ) : attachment.kind === "audio" ? (
                          <VoiceNotePlayer
                            accent={message.role === "user"}
                            durationMs={attachment.durationMs}
                            key={attachment.id}
                            src={attachmentUrl(attachment.id)}
                          />
                        ) : null,
                      )}
                    </div>
                  ) : null}
                </div>
                {message.role === "assistant" && message.citations?.length ? (
                  (() => {
                    // Older stored messages can hold the same chunk twice, so
                    // deduplicate on read as well as when the answer is built.
                    const sources = uniqueCitations(message.citations);
                    return (
                      <details className="chat-citations">
                        <summary>
                          <ShieldCheck size={11} />
                          {sources.length} source{sources.length === 1 ? "" : "s"} used
                        </summary>
                        <div>
                          {sources.map((citation) => (
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
                    );
                  })()
                ) : null}
                {message.role === "assistant" &&
                message.action &&
                !activeTicket ? (
                  <LeadCapture
                    action={message.action}
                    agentId={agentId}
                    conversationId={conversationId}
                    embedToken={embedToken}
                    getSessionId={getSessionId}
                    onSubmitted={() => {
                      setNotice(
                        "Your request is saved. Keep this chat in your history for the reply.",
                      );
                      void refreshHistory();
                    }}
                    requestText={
                      [...messages]
                        .slice(0, messageIndex)
                        .reverse()
                        .find((item) => item.role === "user")
                        ?.content ?? ""
                    }
                  />
                ) : null}
                {collectFeedback && message.role === "assistant" && message.id !== "welcome" ? (
                  <div className="chat-rating">
                    <span>Helpful?</span>
                    <button aria-label="Helpful" onClick={() => rate(message.id, 1)} title="This answer helped" type="button"><ThumbsUp size={11} /></button>
                    <button aria-label="Not helpful" onClick={() => rate(message.id, -1)} title="This answer did not help" type="button"><ThumbsDown size={11} /></button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        {busy ? (
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
        ) : null}
        {notice ? <div className="chat-notice">{notice}</div> : null}
        {error ? <div className="chat-error">{error}</div> : null}
      </div>
      {/* Starter chips only while the thread is untouched: once the visitor has
          asked something they know what to do, and stale prompts get in the
          way of the conversation. */}
      {suggestedQuestions.length && messages.length <= 1 && !busy ? (
        <div className="chat-suggestions">
          {suggestedQuestions.slice(0, 4).map((question) => (
            <button
              disabled={busy || uploading}
              key={question}
              onClick={() => void askSuggested(question)}
              type="button"
            >
              {question}
            </button>
          ))}
        </div>
      ) : null}
      {pendingAttachments.length ? (
        <div className="chat-pending-attachments">
          {pendingAttachments.map((attachment) => (
            <span key={attachment.id}>
              {attachment.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" src={attachmentUrl(attachment.id)} />
              ) : (
                <Mic size={13} />
              )}
              <small>
                {attachment.kind === "audio"
                  ? attachment.transcript || "Voice message"
                  : attachment.fileName}
              </small>
              <button
                aria-label={`Remove ${attachment.fileName}`}
                title="Remove this attachment"
                onClick={() => void removePendingAttachment(attachment)}
                type="button"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {recording ? (
        <div className="chat-composer is-recording-bar">
          <VoiceNoteRecorder
            onCancel={() => setRecording(false)}
            onError={(message) => setError(message)}
            onSend={(file, durationMs) => void sendVoiceNote(file, durationMs)}
          />
        </div>
      ) : (
      <form className="chat-composer" onSubmit={send}>
        <div className="chat-composer-tools">
          <input
            accept="image/jpeg,image/png,image/webp,image/gif"
            aria-label="Attach an image"
            hidden
            onChange={(event) => void chooseImage(event)}
            ref={imageInputRef}
            type="file"
          />
          <button
            aria-label="Attach an image"
            title="Attach an image"
            disabled={busy || uploading || pendingAttachments.length >= 3}
            onClick={() => imageInputRef.current?.click()}
            type="button"
          >
            <ImagePlus size={17} />
          </button>
          <button
            aria-label="Record a voice message"
            title="Record a voice message"
            disabled={busy || uploading}
            onClick={() => {
              setError("");
              setNotice("");
              setRecording(true);
            }}
            type="button"
          >
            <Mic size={17} />
          </button>
          <button
            aria-label="Start a voice call"
            title="Talk to the assistant out loud"
            disabled={busy || uploading || recording}
            onClick={() => void openVoiceCall()}
            type="button"
          >
            <Phone size={17} />
          </button>
        </div>
        <textarea
          aria-label="Message"
          autoComplete="off"
          disabled={busy || uploading}
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
          placeholder={
            uploading ? "Uploading attachment…" : "Ask a question..."
          }
          ref={inputRef}
          rows={1}
        />
        <button
          aria-label="Send"
          className="chat-send-button"
          title="Send message"
          disabled={busy || uploading}
        >
          {busy || uploading ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <ArrowUp size={16} />
          )}
        </button>
      </form>
      )}
      {showBranding ? <footer>Powered by <b>Docent</b></footer> : null}
      {callOptions ? (
        <VoiceCallOverlay
          agentName={name}
          onClose={() => setCallOptions(undefined)}
          onTurns={(callTurns) => closeVoiceCall(callTurns)}
          options={callOptions}
        />
      ) : null}
    </div>
  );
}
