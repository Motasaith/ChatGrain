-- A minimum re-crawl interval for one workspace. Additive; safe through db:push.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "min_refresh_hours" integer;
