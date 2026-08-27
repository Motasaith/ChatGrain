-- Per-workspace suspension and page limit.
--
-- All three are additive and nullable, so earlier releases run unchanged
-- against a database that has them. Safe through db:push.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone;
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "suspended_reason" text;
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "page_limit" integer;
