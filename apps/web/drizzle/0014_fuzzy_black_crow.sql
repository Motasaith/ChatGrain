CREATE TYPE "public"."ticket_kind" AS ENUM('support', 'bug', 'live');--> statement-breakpoint
CREATE TABLE "operator_presence" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_presence_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "business_hours" jsonb;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "kind" "ticket_kind" DEFAULT 'support' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operator_presence" ADD CONSTRAINT "operator_presence_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_presence" ADD CONSTRAINT "operator_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_presence_seen_idx" ON "operator_presence" USING btree ("workspace_id","last_seen_at");