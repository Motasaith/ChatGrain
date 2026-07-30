ALTER TABLE "agents" ADD COLUMN "teaser_messages" text[] DEFAULT '{"Hey! Have a question?","I can help you find the right answer."}' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "attention_message" text DEFAULT 'We''re here!' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "help_center_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "help_center_greeting" text DEFAULT 'How can we help?' NOT NULL;