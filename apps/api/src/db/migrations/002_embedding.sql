-- Graphiti-style embedding configuration for story memory retrieval.
ALTER TABLE llm_settings
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  ADD COLUMN IF NOT EXISTS embedding_enabled BOOLEAN NOT NULL DEFAULT TRUE;
