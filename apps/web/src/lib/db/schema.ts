import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "@/lib/agents/default-prompt";

export const agentStatus = pgEnum("agent_status", [
  "draft",
  "training",
  "ready",
  "error",
  "paused",
]);
export const sourceType = pgEnum("source_type", [
  "website",
  "sitemap",
  "url",
  "file",
  "text",
  "qa",
]);
export const sourceStatus = pgEnum("source_status", [
  "pending",
  "crawling",
  "indexing",
  "ready",
  "error",
]);
/**
 * Where a crawl job currently is. `progress` alone cannot explain a stall -
 * "68%" could mean fetching, embedding, or writing - so the phase is stored
 * separately and shown to the operator.
 */
export const jobPhase = pgEnum("job_phase", [
  "queued",
  "crawling",
  "embedding",
  "indexing",
  "done",
]);

export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const conversationStatus = pgEnum("conversation_status", [
  "open",
  "resolved",
  "escalated",
]);
export const messageRole = pgEnum("message_role", [
  "user",
  "assistant",
  "operator",
  "system",
  "tool",
]);
export const attachmentKind = pgEnum("attachment_kind", [
  "image",
  "audio",
  "file",
]);
export const ticketStatus = pgEnum("ticket_status", [
  "open",
  "pending",
  "waiting_on_visitor",
  "resolved",
  "closed",
]);
export const ticketPriority = pgEnum("ticket_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);
export const actionType = pgEnum("action_type", [
  "lead_form",
  "webhook",
  "link",
  "human_handoff",
  "custom_api",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: text("external_id"),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    retentionExempt: boolean("retention_exempt").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_external_id_unique").on(table.externalId),
    index("users_last_seen_idx").on(table.lastSeenAt),
  ],
);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").default("community").notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
  ...timestamps,
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.workspaceId] })],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    status: agentStatus("status").default("draft").notNull(),
    systemPrompt: text("system_prompt")
      .default(DEFAULT_AGENT_SYSTEM_PROMPT)
      .notNull(),
    welcomeMessage: text("welcome_message")
      .default("Hi! How can I help?")
      .notNull(),
    fallbackMessage: text("fallback_message")
      .default("I couldn’t find a reliable answer in the connected sources.")
      .notNull(),
    primaryColor: text("primary_color").default("#177e51").notNull(),
    logoUrl: text("logo_url"),
    iconUrl: text("icon_url"),
    widgetPosition: text("widget_position").default("right").notNull(),
    teaserMessages: text("teaser_messages")
      .array()
      .default([
        "Hey! Have a question?",
        "I can help you find the right answer.",
      ])
      .notNull(),
    attentionMessage: text("attention_message")
      .default("Ask us anything")
      .notNull(),
    suggestedQuestions: text("suggested_questions")
      .array()
      .default([])
      .notNull(),
    helpCenterEnabled: boolean("help_center_enabled").default(true).notNull(),
    helpCenterGreeting: text("help_center_greeting")
      .default("How can we help?")
      .notNull(),
    showBranding: boolean("show_branding").default(true).notNull(),
    collectFeedback: boolean("collect_feedback").default(true).notNull(),
    followUpSuggestions: boolean("follow_up_suggestions")
      .default(true)
      .notNull(),
    showCitations: boolean("show_citations").default(true).notNull(),
    strictMode: boolean("strict_mode").default(true).notNull(),
    allowedDomains: text("allowed_domains").array().default([]).notNull(),
    modelProvider: text("model_provider").default("ollama").notNull(),
    modelName: text("model_name").default("gemma4:31b"),
    temperature: real("temperature").default(0.1).notNull(),
    ...timestamps,
  },
  (table) => [
    index("agents_workspace_idx").on(table.workspaceId),
    index("agents_status_idx").on(table.status),
  ],
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    type: sourceType("type").notNull(),
    status: sourceStatus("status").default("pending").notNull(),
    name: text("name").notNull(),
    rootUrl: text("root_url"),
    includePaths: text("include_paths").array().default([]).notNull(),
    excludePaths: text("exclude_paths").array().default([]).notNull(),
    pageLimit: integer("page_limit").default(10_000).notNull(),
    refreshIntervalHours: integer("refresh_interval_hours"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    ...timestamps,
  },
  (table) => [
    index("sources_agent_idx").on(table.agentId),
    index("sources_status_idx").on(table.status),
    uniqueIndex("sources_agent_root_url_unique")
      .on(table.agentId, table.rootUrl)
      .where(sql`${table.rootUrl} is not null`),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    canonicalUrl: text("canonical_url"),
    title: text("title").notNull(),
    contentHash: text("content_hash").notNull(),
    mimeType: text("mime_type").default("text/html").notNull(),
    characterCount: integer("character_count").default(0).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("documents_source_idx").on(table.sourceId),
    uniqueIndex("documents_source_url_unique")
      .on(table.sourceId, table.canonicalUrl)
      .where(sql`${table.canonicalUrl} is not null`),
  ],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").default(0).notNull(),
    embedding: vector("embedding", { dimensions: 384 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("chunks_agent_idx").on(table.agentId),
    index("chunks_document_idx").on(table.documentId),
    index("chunks_embedding_hnsw").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("chunks_content_fts").using(
      "gin",
      sql`to_tsvector('english', ${table.content})`,
    ),
  ],
);

export const pinnedAnswers = pgTable(
  "pinned_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    questions: text("questions").array().notNull(),
    answer: text("answer").notNull(),
    useCount: integer("use_count").default(0).notNull(),
    ...timestamps,
  },
  (table) => [index("pinned_answers_agent_idx").on(table.agentId)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    externalUserId: text("external_user_id"),
    sessionId: text("session_id").notNull(),
    status: conversationStatus("status").default("open").notNull(),
    channel: text("channel").default("widget").notNull(),
    visitorName: text("visitor_name"),
    visitorEmail: text("visitor_email"),
    visitorCountry: text("visitor_country"),
    sentiment: text("sentiment"),
    topic: text("topic"),
    title: text("title"),
    visitorLastReadAt: timestamp("visitor_last_read_at", {
      withTimezone: true,
    }),
    operatorLastReadAt: timestamp("operator_last_read_at", {
      withTimezone: true,
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("conversations_agent_last_message_idx").on(
      table.agentId,
      table.lastMessageAt,
    ),
    uniqueIndex("conversations_visitor_session_unique").on(
      table.agentId,
      table.externalUserId,
      table.sessionId,
    ),
    index("conversations_visitor_history_idx").on(
      table.agentId,
      table.externalUserId,
      table.lastMessageAt,
    ),
    index("conversations_session_idx").on(table.sessionId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations")
      .$type<
        Array<{ chunkId: string; title: string; url?: string; excerpt: string }>
      >()
      .default([]),
    // Interactive follow-up attached to an answer, such as the lead form. It
    // must be stored: it was previously only present on the live response, so
    // any history reload silently dropped the form the visitor was filling in.
    action: jsonb("action").$type<{
      type: string;
      title: string;
      description: string;
      submitLabel: string;
    } | null>(),
    grounded: boolean("grounded"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("messages_conversation_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "cascade",
    }),
    kind: attachmentKind("kind").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    durationMs: integer("duration_ms"),
    transcript: text("transcript"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("message_attachments_conversation_idx").on(table.conversationId),
    index("message_attachments_message_idx").on(table.messageId),
  ],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("feedback_message_unique").on(table.messageId)],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    data: jsonb("data").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("leads_agent_idx").on(table.agentId)],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reference: text("reference").notNull().unique(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, {
      onDelete: "set null",
    }),
    subject: text("subject").notNull(),
    status: ticketStatus("status").default("open").notNull(),
    priority: ticketPriority("priority").default("normal").notNull(),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    requesterName: text("requester_name"),
    requesterEmail: text("requester_email"),
    requesterPhone: text("requester_phone"),
    lastReplyBy: text("last_reply_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tickets_conversation_unique").on(table.conversationId),
    index("tickets_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    index("tickets_agent_idx").on(table.agentId),
  ],
);

export const actions = pgTable(
  "actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    type: actionType("type").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    ...timestamps,
  },
  (table) => [index("actions_agent_idx").on(table.agentId)],
);

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").default("disconnected").notNull(),
    encryptedCredentials: text("encrypted_credentials"),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("integrations_workspace_provider_unique").on(
      table.workspaceId,
      table.provider,
    ),
  ],
);

export const crawlJobs = pgTable(
  "crawl_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    status: jobStatus("status").default("queued").notNull(),
    attempt: integer("attempt").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    priority: integer("priority").default(0).notNull(),
    progress: integer("progress").default(0).notNull(),
    phase: jobPhase("phase").default("queued").notNull(),
    pagesDiscovered: integer("pages_discovered").default(0).notNull(),
    pagesProcessed: integer("pages_processed").default(0).notNull(),
    /** Pages whose content hash was unchanged, so embedding was skipped. */
    pagesSkipped: integer("pages_skipped").default(0).notNull(),
    pagesFailed: integer("pages_failed").default(0).notNull(),
    pagesEmbedded: integer("pages_embedded").default(0).notNull(),
    chunksIndexed: integer("chunks_indexed").default(0).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("crawl_jobs_queue_idx").on(
      table.status,
      table.nextAttemptAt,
      table.priority,
    ),
  ],
);

/**
 * One row per URL touched by a crawl, so an operator can see exactly which
 * pages were indexed, reused, or failed, and why.
 *
 * Rows are replaced on each run of a source rather than accumulated: keeping
 * the history for a 7,000-page site would grow without bound while only the
 * latest run is ever useful.
 */
export const crawlPages = pgTable(
  "crawl_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => crawlJobs.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /**
     * Order the page was handled in. Rows are written in batches whose
     * timestamps are nearly identical, so `createdAt` cannot order them and a
     * "most recent pages" view would be arbitrary without this.
     */
    sequence: integer("sequence").default(0).notNull(),
    /** indexed | unchanged | duplicate | thin | failed */
    outcome: text("outcome").notNull(),
    title: text("title"),
    reason: text("reason"),
    chunkCount: integer("chunk_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("crawl_pages_job_sequence_idx").on(table.jobId, table.sequence),
    index("crawl_pages_job_outcome_idx").on(table.jobId, table.outcome),
    index("crawl_pages_source_idx").on(table.sourceId),
  ],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    type: text("type").notNull(),
    properties: jsonb("properties").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("events_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("events_agent_created_idx").on(table.agentId, table.createdAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    ipAddress: text("ip_address"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_logs_created_idx").on(table.createdAt),
    index("audit_logs_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("audit_logs_actor_idx").on(table.actorUserId),
  ],
);

export const systemLogs = pgTable(
  "system_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    level: text("level").default("info").notNull(),
    service: text("service").default("docent-web").notNull(),
    message: text("message").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("system_logs_created_idx").on(table.createdAt),
    index("system_logs_level_created_idx").on(table.level, table.createdAt),
  ],
);

export const systemState = pgTable("system_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type Source = typeof sources.$inferSelect;
