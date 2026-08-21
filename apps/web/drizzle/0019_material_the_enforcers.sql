ALTER TABLE "documents" ADD COLUMN "run_id" uuid;--> statement-breakpoint
CREATE INDEX "documents_run_idx" ON "documents" USING btree ("source_id","run_id");