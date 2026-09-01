-- Who may operate this installation, stored rather than configured.
--
-- Additive: one column with a default, so every existing user becomes a
-- "member" and an earlier build runs unchanged against a database that has it.
--
-- ADMIN_EMAILS is deliberately not migrated into this column. It stays as the
-- recovery path: anyone listed there is a superadmin whatever this table says,
-- so a mistaken demotion, a bad migration or a restored backup cannot lock
-- everybody out of the interface that grants access.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "platform_role" text DEFAULT 'member' NOT NULL;

-- Answers "who can operate this installation" without scanning every user.
-- Partial, because the overwhelming majority of rows are members and indexing
-- them would be paying for the answer nobody asks.
CREATE INDEX IF NOT EXISTS "users_platform_role_idx"
  ON "users" ("platform_role") WHERE "platform_role" <> 'member';
