-- PostgreSQL stores canonical application state (narrative structure).
-- Semantic/episodic memory lives in FalkorDB via the MemoryService.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Stories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  description TEXT,
  genre       TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Story preferences (versioned so users can see change history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS story_preferences (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  story_id       UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  preferences    JSONB NOT NULL,
  note           TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_preferences_story ON story_preferences(story_id, version);

-- ---------------------------------------------------------------------------
-- Branches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  story_id         UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  parent_branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branches_story ON branches(story_id);

-- ---------------------------------------------------------------------------
-- Chapters
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chapters (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  story_id  UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  "order"   INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Story nodes (the narrative tree)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS story_nodes (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  story_id             UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  branch_id            UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  parent_node_id       UUID REFERENCES story_nodes(id) ON DELETE SET NULL,
  position             INTEGER NOT NULL DEFAULT 0,
  content              TEXT NOT NULL DEFAULT '',
  node_type            TEXT NOT NULL DEFAULT 'AI_GENERATED',
  author               TEXT NOT NULL DEFAULT 'ai',
  continuation_label   TEXT,
  is_current           BOOLEAN NOT NULL DEFAULT FALSE,
  chapter_id           UUID REFERENCES chapters(id) ON DELETE SET NULL,
  chapter_title        TEXT,
  generation_metadata  JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nodes_branch ON story_nodes(branch_id, position);
CREATE INDEX IF NOT EXISTS idx_nodes_story ON story_nodes(story_id);

-- ---------------------------------------------------------------------------
-- Episodic memory records (semantic content lives in FalkorDB; this table maps
-- episodes to nodes and stores embeddings for retrieval).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_episodes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  story_id    UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  branch_id   UUID REFERENCES branches(id) ON DELETE CASCADE,
  node_id     UUID REFERENCES story_nodes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  body        TEXT NOT NULL,
  embedding   REAL[],
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_episodes_story ON memory_episodes(story_id);
CREATE INDEX IF NOT EXISTS idx_episodes_branch ON memory_episodes(branch_id);

-- ---------------------------------------------------------------------------
-- LLM / provider settings (single-user; no secrets in plaintext)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS llm_settings (
  id           INTEGER PRIMARY KEY DEFAULT 1,
  provider     TEXT NOT NULL DEFAULT 'openai_compatible',
  base_url     TEXT NOT NULL,
  model        TEXT NOT NULL,
  api_key_enc  TEXT, -- encrypted value stored server-side only
  temperature  REAL NOT NULL DEFAULT 0.8,
  max_tokens   INTEGER NOT NULL DEFAULT 4096,
  top_p        REAL NOT NULL DEFAULT 1.0,
  suggestion_count   INTEGER NOT NULL DEFAULT 3,
  retrieval_depth    INTEGER NOT NULL DEFAULT 5,
  recent_node_count  INTEGER NOT NULL DEFAULT 5,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure a single settings row exists.
INSERT INTO llm_settings (id, base_url, model)
SELECT 1, 'https://api.openai.com/v1', 'gpt-4o-mini'
WHERE NOT EXISTS (SELECT 1 FROM llm_settings WHERE id = 1);
