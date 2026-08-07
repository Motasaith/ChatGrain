ALTER TABLE "agents" ADD COLUMN "suggested_questions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "action" jsonb;