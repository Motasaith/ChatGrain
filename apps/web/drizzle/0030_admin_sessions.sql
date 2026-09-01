-- Administrator edit sessions, and the restore point each one leaves behind.
--
-- Additive: one new table, four new nullable columns, and a trigger. An earlier
-- build runs unchanged against a database that has all of it.

CREATE TABLE IF NOT EXISTS "admin_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "admin_email" text NOT NULL,
  "reason" text,
  -- open | kept | discarded | reverted
  "status" text DEFAULT 'open' NOT NULL,
  -- The workspace's whole configuration as it stood when the session began.
  -- Small: four tables of a few rows each, none of them the corpus.
  "snapshot" jsonb NOT NULL,
  -- What actually differed, worked out when the session ended.
  "summary" jsonb,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone,
  "decided_at" timestamp with time zone,
  "decided_by" text
);

-- Matches what the Drizzle schema declares, and only that. `db:push` runs on
-- every deploy and treats the schema file as the truth, so an index created
-- here but not declared there is dropped by the very next deploy - silently.
-- There was a second index on (status, started_at) here; nothing queries these
-- rows by status, so it is gone rather than declared.
CREATE INDEX IF NOT EXISTS "admin_sessions_workspace_idx"
  ON "admin_sessions" ("workspace_id", "started_at");

-- Keeping updated_at honest on the four tables a session can change.
--
-- The columns already exist. What did not exist is anything guaranteeing they
-- are current: they default to now() on insert, and are then only refreshed by
-- the handful of routes that remember to set them explicitly. Most do not.
--
-- That matters here because discarding a session has to tell "the administrator
-- changed this" from "the customer changed this while the administrator was in
-- there". A stale timestamp makes a customer edit look untouched, and the
-- restore would silently overwrite their work - the exact failure that would
-- discredit the feature.
--
-- Deliberately a trigger and not application code. There are dozens of places
-- that update these tables and there will be more; a column that every one of
-- them has to remember to set is a column that is wrong the first time somebody
-- forgets, and it would be wrong silently. The database sees every write,
-- including from psql during an incident.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agents_set_updated_at ON "agents";
CREATE TRIGGER agents_set_updated_at BEFORE UPDATE ON "agents"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS sources_set_updated_at ON "sources";
CREATE TRIGGER sources_set_updated_at BEFORE UPDATE ON "sources"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pinned_answers_set_updated_at ON "pinned_answers";
CREATE TRIGGER pinned_answers_set_updated_at BEFORE UPDATE ON "pinned_answers"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS actions_set_updated_at ON "actions";
CREATE TRIGGER actions_set_updated_at BEFORE UPDATE ON "actions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
