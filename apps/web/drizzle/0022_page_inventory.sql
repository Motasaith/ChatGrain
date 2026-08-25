-- crawl_pages becomes a persistent page inventory, keyed by URL per source
-- rather than per crawl job.
--
-- Run this with psql rather than relying on `db:push`. Push generates the
-- schema changes but not the de-duplication below, and creating the new unique
-- index on a database that still holds one row per URL *per job* fails.

-- The operator's per-URL decision, and when the URL was first and last seen.
ALTER TABLE "crawl_pages" ADD COLUMN IF NOT EXISTS "selected" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN IF NOT EXISTS "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint

-- Existing rows predate both columns; their creation time is the best estimate
-- available for when the URL was seen.
UPDATE "crawl_pages" SET "first_seen_at" = "created_at", "last_seen_at" = "created_at";
--> statement-breakpoint

-- Collapse the per-job rows into one row per URL, keeping the most recent.
-- The old model allowed the same URL to appear once for every crawl of the
-- source, which is exactly what the new unique index forbids.
DELETE FROM "crawl_pages" a
USING "crawl_pages" b
WHERE a.source_id = b.source_id
  AND a.url = b.url
  AND (a.created_at, a.id) < (b.created_at, b.id);
--> statement-breakpoint

DROP INDEX IF EXISTS "crawl_pages_job_url_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crawl_pages_source_url_unique" ON "crawl_pages" ("source_id","url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_pages_source_sequence_idx" ON "crawl_pages" ("source_id","sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_pages_source_outcome_idx" ON "crawl_pages" ("source_id","outcome");
--> statement-breakpoint

-- The inventory outlives any individual job, so pruning old jobs must not take
-- the page list with it.
ALTER TABLE "crawl_pages" ALTER COLUMN "job_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "crawl_pages" DROP CONSTRAINT IF EXISTS "crawl_pages_job_id_crawl_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_job_id_crawl_jobs_id_fk"
  FOREIGN KEY ("job_id") REFERENCES "crawl_jobs"("id") ON DELETE SET NULL;
