-- A customer's recorded permission for an administrator to change their account.
--
-- Additive: a new table and nothing else, so an earlier build runs unchanged
-- against a database that has it. Safe through db:push.
CREATE TABLE IF NOT EXISTS "impersonation_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "admin_email" text NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "token" text NOT NULL UNIQUE,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "responded_at" timestamp with time zone,
  "responded_by_email" text,
  "grant_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- The two questions actually asked of this table: "may this administrator write
-- to this workspace right now" on every write session start, and "what is
-- waiting for me to answer" on the customer's own screen.
CREATE INDEX IF NOT EXISTS "impersonation_grants_lookup_idx"
  ON "impersonation_grants" ("workspace_id", "admin_email", "status");
CREATE INDEX IF NOT EXISTS "impersonation_grants_pending_idx"
  ON "impersonation_grants" ("workspace_id", "status", "requested_at");
