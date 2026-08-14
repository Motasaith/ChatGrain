-- Move the vector column from 384 dims (all-MiniLM-L6-v2) to 1024
-- (Qwen3-Embedding-0.6B).
--
-- Three things make the generated one-liner unsafe on a database that already
-- holds rows, so each is handled explicitly:
--
--   1. Postgres cannot cast a vector(384) value to vector(1024). Existing
--      embeddings are not convertible and not salvageable - a vector only means
--      anything to the model that produced it - so they are cleared. Every
--      affected agent must be re-indexed afterwards.
--   2. The HNSW index is bound to the old column type and blocks the ALTER.
--   3. Rebuilding the index over a freshly emptied column is instant; doing it
--      before the backfill would be wasted work.
--
-- Retrieval degrades to keyword-only until re-indexing runs, because the
-- vector search simply finds no non-null embeddings. It does not return wrong
-- answers in the meantime.

DROP INDEX IF EXISTS "chunks_embedding_hnsw";--> statement-breakpoint
UPDATE "chunks" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);
