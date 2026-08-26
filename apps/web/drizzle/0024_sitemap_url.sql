-- An operator-supplied sitemap, tried before any path is guessed.
--
-- Additive with no default, so earlier releases run unchanged against a
-- database that has it. Safe through db:push.
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "sitemap_url" text;
