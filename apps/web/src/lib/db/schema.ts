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
    systemPrompt: text("system_prompt").default("").notNull(),
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
    showBranding: boolean("show_branding").default(true).notNull(),
    collectFeedback: boolean("collect_feedback").default(true).notNull(),
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
    pageLimit: integer("page_limit").default(100).notNull(),
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
    grounded: boolean("grounded"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("messages_conversation_idx").on(table.conversationId)],
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
    pagesDiscovered: integer("pages_discovered").default(0).notNull(),
    pagesProcessed: integer("pages_processed").default(0).notNull(),
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
