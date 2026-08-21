ALTER TABLE "crawl_jobs" ADD COLUMN "recoveries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD COLUMN "max_recoveries" integer DEFAULT 10 NOT NULL;