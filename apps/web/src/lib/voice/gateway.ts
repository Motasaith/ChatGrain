import { createServer, type IncomingMessage } from "node:http";
import { and, eq } from "drizzle-orm";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { agents, conversations } from "@/lib/db/schema";
import { rateLimit } from "@/lib/http/rate-limit";
import { logger } from "@/lib/observability/logger";
import {
  domainAllowed,
  normalizeHost,
  verifyWidgetToken,
} from "@/lib/security/widget-token";
import {
  encodeAudioFrame,
  type ClientMessage,
  type ServerMessage,
} from "@/lib/voice/protocol";
import { VoiceSession } from "@/lib/voice/session";
import { sttEnabled } from "@/lib/voice/stt";
import { ttsEnabled } from "@/lib/voice/tts";

const startSchema = z.object({
  type: z.literal("start"),
  agentId: z.uuid(),
  sessionId: z.string().trim().min(8).max(200),
  conversationId: z.uuid().optional(),
  externalUserId: z.string().trim().max(200).optional(),
  embedToken: z.string().max(2_000).optional(),
  locale: z.string().trim().max(20).optional(),
  path: z.string().max(500).optional(),
});

/** A caller who never sends `start` is dropped rather than held open. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Liveness probe interval; browsers answer with a pong automatically. */
const HEARTBEAT_MS = 25_000;

/** Ceiling on one binary audio frame (a 20 ms frame is 640 bytes). */
const MAX_AUDIO_FRAME_BYTES = 16_000;

export function voicePort() {
  return Number(process.env.VOICE_WS_PORT?.trim()) || 3_002;
}

export function voiceEnabled() {
  return process.env.VOICE_ENABLED?.trim() !== "false";
}

function clientIp(request: IncomingMessage) {
  const forwarded = request.headers["x-forwarded-for"];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return header?.split(",")[0]?.trim() || request.socket.remoteAddress || "local";
}

export function startVoiceGateway() {
  const port = voicePort();
  const httpServer = createServer((request, response) => {
    // Answers at `/health` when probed directly, and at `/voice/health` when a
    // proxy routes the whole `/voice` prefix here and preserves the path.
    // Without the second form the check reports 426 through the proxy and looks
    // like a routing failure.
    const path = (request.url ?? "").split("?")[0];
    if (path === "/health" || path === "/voice/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ok",
          stt: sttEnabled(),
          tts: ttsEnabled(),
        }),
      );
      return;
    }
    response.writeHead(426, { "content-type": "text/plain" });
    response.end("This endpoint expects a WebSocket upgrade.");
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/voice" });

  wss.on("connection", (socket, request) => {
    handleConnection(socket, request).catch((error) => {
      logger.warn({ error }, "Voice connection failed");
      closeWith(socket, "SESSION_FAILED", "The voice session could not start.");
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const client = socket as WebSocket & { isAlive?: boolean };
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  httpServer.listen(port, () => {
    logger.info(
      { port, stt: sttEnabled(), tts: ttsEnabled() },
      "ChatGrain voice gateway listening",
    );
  });

  return async () => {
    clearInterval(heartbeat);
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function closeWith(socket: WebSocket, code: string, message: string) {
  send(socket, { type: "error", code, message, fatal: true });
  socket.close(1008, code);
}

async function handleConnection(socket: WebSocket, request: IncomingMessage) {
  const client = socket as WebSocket & { isAlive?: boolean };
  client.isAlive = true;
  socket.on("pong", () => {
    client.isAlive = true;
  });

  const ip = clientIp(request);
  try {
    rateLimit(`voice:${ip}`, 12, 60_000);
  } catch {
    closeWith(socket, "RATE_LIMITED", "Too many voice sessions. Try again soon.");
    return;
  }

  const started = await waitForStart(socket);
  if (!started) return;

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, started.agentId))
    .limit(1);
  if (!agent || agent.status === "paused") {
    closeWith(socket, "AGENT_NOT_AVAILABLE", "Agent is not available.");
    return;
  }

  if (agent.allowedDomains.length) {
    if (!started.embedToken) {
      closeWith(
        socket,
        "WIDGET_TOKEN_REQUIRED",
        "This agent requires an authorized widget session.",
      );
      return;
    }
    try {
      const token = await verifyWidgetToken(started.embedToken, agent.id);
      const origin = request.headers.origin
        ? normalizeHost(request.headers.origin)
        : "";
      if (
        token.host !== "__dashboard__" &&
        (!domainAllowed(token.host, agent.allowedDomains) ||
          (origin && !domainAllowed(origin, agent.allowedDomains)))
      ) {
        closeWith(
          socket,
          "DOMAIN_NOT_ALLOWED",
          "This agent is not allowed on the requesting domain.",
        );
        return;
      }
    } catch {
      closeWith(socket, "WIDGET_TOKEN_INVALID", "Widget session is not valid.");
      return;
    }
  }

  const conversation = await resolveConversation(agent.id, started);
  if (!conversation) {
    closeWith(socket, "CONVERSATION_NOT_FOUND", "Conversation not found.");
    return;
  }

  const session = new VoiceSession({
    agent,
    conversationId: conversation.id,
    sessionId: started.sessionId,
    locale: started.locale,
    send: (message) => send(socket, message),
    sendAudio: (turnId, pcm) => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(encodeAudioFrame(turnId, pcm), { binary: true });
    },
  });

  send(socket, {
    type: "ready",
    conversationId: conversation.id,
    sessionId: started.sessionId,
    sttEnabled: sttEnabled(),
    ttsEnabled: ttsEnabled(),
    greeting: agent.welcomeMessage ?? undefined,
  });
  send(socket, { type: "state", value: "listening" });

  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      const frame = toUint8Array(data);
      if (frame && frame.byteLength <= MAX_AUDIO_FRAME_BYTES) {
        session.appendAudio(frame);
      }
      return;
    }
    const message = parseClientMessage(data);
    if (!message) return;
    switch (message.type) {
      case "speech_start":
        session.speechStart();
        break;
      case "utterance_end":
        session.utteranceEnd();
        break;
      case "interrupt":
        session.interrupt(message.turnId);
        break;
      case "text":
        session.submitText(message.content);
        break;
      case "ping":
        break;
      case "stop":
        socket.close(1000, "client_stopped");
        break;
      default:
        break;
    }
  });

  socket.on("close", () => {
    void session.close();
  });
  socket.on("error", (error) => {
    logger.debug({ error }, "Voice socket error");
    void session.close();
  });
}

function waitForStart(socket: WebSocket) {
  return new Promise<z.infer<typeof startSchema> | null>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      closeWith(socket, "HANDSHAKE_TIMEOUT", "No voice session was started.");
      resolve(null);
    }, HANDSHAKE_TIMEOUT_MS);

    const onMessage = (data: unknown, isBinary: boolean) => {
      if (isBinary) return; // Audio before `start` is discarded.
      const parsed = startSchema.safeParse(
        parseClientMessage(data as Parameters<typeof toUint8Array>[0]),
      );
      cleanup();
      if (!parsed.success) {
        closeWith(socket, "INVALID_START", "The voice session request is invalid.");
        resolve(null);
        return;
      }
      resolve(parsed.data);
    };

    const onClose = () => {
      cleanup();
      resolve(null);
    };

    function cleanup() {
      clearTimeout(timer);
      socket.off("message", onMessage as never);
      socket.off("close", onClose);
    }

    socket.on("message", onMessage as never);
    socket.on("close", onClose);
  });
}

async function resolveConversation(
  agentId: string,
  started: z.infer<typeof startSchema>,
) {
  if (started.conversationId) {
    const [existing] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, started.conversationId),
          eq(conversations.agentId, agentId),
          eq(conversations.sessionId, started.sessionId),
        ),
      )
      .limit(1);
    return existing ?? null;
  }
  const [created] = await db
    .insert(conversations)
    .values({
      agentId,
      sessionId: started.sessionId,
      externalUserId: started.externalUserId,
      channel: "voice",
      metadata: started.path ? { path: started.path } : {},
    })
    .returning();
  return created ?? null;
}

function toUint8Array(data: unknown): Uint8Array | null {
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (Array.isArray(data)) {
    return toUint8Array(Buffer.concat(data as Buffer[]));
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

function parseClientMessage(data: unknown): ClientMessage | null {
  try {
    const text = Buffer.isBuffer(data)
      ? data.toString("utf8")
      : typeof data === "string"
        ? data
        : toUint8Array(data)
          ? Buffer.from(toUint8Array(data)!).toString("utf8")
          : "";
    if (!text) return null;
    const parsed = JSON.parse(text) as ClientMessage;
    return parsed && typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}
