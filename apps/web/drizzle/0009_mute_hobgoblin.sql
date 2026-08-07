CREATE TYPE "public"."job_phase" AS ENUM('queued', 'crawling', 'embedding', 'indexing', 'done');--> statement-breakpoint
CREATE TABLE "crawl_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"url" text NOT NULL,
	"outcome" text NOT NULL,
	"title" text,
	"reason" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "attention_message" SET DEFAULT 'Ask us anything';--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD COLUMN "phase" "job_phase" DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD COLUMN "pages_skipped" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD COLUMN "pages_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD COLUMN "pages_embedded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD COLUMN "chunks_indexed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_job_id_crawl_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."crawl_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_pages_job_idx" ON "crawl_pages" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "crawl_pages_job_outcome_idx" ON "crawl_pages" USING btree ("job_id","outcome");--> statement-breakpoint
CREATE INDEX "crawl_pages_source_idx" ON "crawl_pages" USING btree ("source_id");