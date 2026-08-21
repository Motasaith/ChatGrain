ALTER TYPE "public"."job_status" ADD VALUE 'partial' BEFORE 'failed';--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_pages_job_url_unique" ON "crawl_pages" USING btree ("job_id","url");