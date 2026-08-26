-- A crawl now finds the URLs first, waits for a person to approve them, and
-- only then fetches and indexes.
--
-- Run with psql. Postgres will not add an enum value and use it in the same
-- transaction, which is what `db:push` would try to do.

ALTER TYPE "job_status" ADD VALUE IF NOT EXISTS 'awaiting_review' AFTER 'queued';
--> statement-breakpoint
ALTER TYPE "job_phase" ADD VALUE IF NOT EXISTS 'discovering' AFTER 'queued';
--> statement-breakpoint

-- Null means discovery has not run, which is how a resumed job knows whether
-- to look for URLs or start fetching them.
ALTER TABLE "crawl_jobs" ADD COLUMN IF NOT EXISTS "discovered_at" timestamp with time zone;
--> statement-breakpoint

-- Scheduled re-crawls run with nobody awake to approve anything, so they index
-- whatever the last review selected.
ALTER TABLE "crawl_jobs" ADD COLUMN IF NOT EXISTS "auto_approve" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Jobs that finished under the old one-pass model never had a discovery step.
-- Marking them as discovered keeps their history readable and stops anything
-- looking at an old row from concluding it is halfway through a new flow.
UPDATE "crawl_jobs"
SET "discovered_at" = COALESCE("started_at", "created_at")
WHERE "discovered_at" IS NULL
  AND "status" IN ('succeeded', 'partial', 'failed', 'cancelled');
