-- Per-workspace usage, rolled up by day. Additive; safe through db:push.
CREATE TABLE IF NOT EXISTS "workspace_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "day" text NOT NULL,
  "kind" text NOT NULL,
  "calls" integer DEFAULT 0 NOT NULL,
  "units" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_usage_day_kind_unique" ON "workspace_usage" ("workspace_id","day","kind");
CREATE INDEX IF NOT EXISTS "workspace_usage_workspace_idx" ON "workspace_usage" ("workspace_id","day");
