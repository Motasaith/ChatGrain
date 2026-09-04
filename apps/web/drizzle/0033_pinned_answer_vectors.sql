-- Embeddings for the question variations on a pinned answer.
--
-- Additive: one nullable column. A row without it falls back to the word
-- overlap matching that came before, so nothing regresses while these are
-- being filled in.
--
-- jsonb rather than a vector column because there are several vectors per row -
-- one per question variation - and pgvector holds one per column. These are
-- compared in application code against a handful of rows, not searched with an
-- index across millions, so the storage format costs nothing here.
ALTER TABLE "pinned_answers"
  ADD COLUMN IF NOT EXISTS "question_vectors" jsonb;
