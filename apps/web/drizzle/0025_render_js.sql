-- Per-source browser rendering policy: auto (detect), always, or never.
-- Additive with a default, so earlier releases run unchanged. Safe via db:push.
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "render_js" text DEFAULT 'auto' NOT NULL;
