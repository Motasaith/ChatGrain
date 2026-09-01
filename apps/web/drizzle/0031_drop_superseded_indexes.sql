-- Two dead indexes on crawl_pages, dropped explicitly.
--
-- `crawl_pages` was keyed on the job that found a page until 0022 re-keyed it on
-- the source, so a page could survive across crawls. That migration replaced
-- these two with "crawl_pages_source_sequence_idx" and
-- "crawl_pages_source_outcome_idx", and dropped the unique index beside them -
-- but left these behind.
--
-- In practice they are already gone: `db:push` runs on every deploy, finds them
-- absent from the schema file, and drops them. Saying so here makes the intent
-- explicit rather than leaving it as a side effect nobody chose, and stops them
-- reappearing on any installation that replays the migrations.
--
-- They are not free to keep. `crawl_pages` takes a row per URL per crawl, so a
-- large site writes tens of thousands during an index, and every surplus index
-- is paid for on each of those writes.
DROP INDEX IF EXISTS "crawl_pages_job_idx";
DROP INDEX IF EXISTS "crawl_pages_job_outcome_idx";
