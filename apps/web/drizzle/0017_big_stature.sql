-- Move the vector column from 1024 dims (Qwen3-Embedding-0.6B) to 768
-- (EmbeddingGemma-300M).
--
-- Same three constraints as migration 0016, for the same reasons: vector(1024)
-- cannot be cast to vector(768), the HNSW index is bound to the old type and
-- blocks the ALTER, and rebuilding the index over an emptied column is instant.
--
-- This one is nearly free. Migration 0016 already cleared every embedding and
-- no agent has been re-indexed since, so in practice there is nothing to lose
-- here - which is exactly why the model swap happened now rather than after a
-- ten-site indexing run.

DROP INDEX IF EXISTS "chunks_embedding_hnsw";--> statement-breakpoint
UPDATE "chunks" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(768);--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);
