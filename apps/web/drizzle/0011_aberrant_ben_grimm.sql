DROP INDEX "crawl_pages_job_idx";--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "crawl_pages_job_sequence_idx" ON "crawl_pages" USING btree ("job_id","sequence");