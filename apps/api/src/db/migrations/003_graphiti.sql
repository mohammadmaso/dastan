-- Branch fork point, sibling ordering, cascade deletes, one-current-per-branch,
-- and reshape memory_episodes into a Graphiti uuid map (no local embeddings).

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS fork_node_id UUID REFERENCES story_nodes(id) ON DELETE SET NULL;

ALTER TABLE story_nodes
  ADD COLUMN IF NOT EXISTS sibling_index INTEGER NOT NULL DEFAULT 0;

-- Orphan children of a deleted node instead of leaving dangling parents.
ALTER TABLE story_nodes DROP CONSTRAINT IF EXISTS story_nodes_parent_node_id_fkey;
ALTER TABLE story_nodes
  ADD CONSTRAINT story_nodes_parent_node_id_fkey
  FOREIGN KEY (parent_node_id) REFERENCES story_nodes(id) ON DELETE CASCADE;

-- Deduplicate any pre-existing double-current rows, then enforce one current per branch.
UPDATE story_nodes SET is_current = FALSE
 WHERE is_current = TRUE
   AND id NOT IN (
     SELECT DISTINCT ON (branch_id) id FROM story_nodes
     WHERE is_current = TRUE
     ORDER BY branch_id, updated_at DESC
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_one_current
  ON story_nodes (branch_id) WHERE is_current = TRUE;

-- Drop the local embedding column; Graphiti owns vectors now.
ALTER TABLE memory_episodes DROP COLUMN IF EXISTS embedding;
ALTER TABLE memory_episodes DROP COLUMN IF EXISTS body;
ALTER TABLE memory_episodes ADD COLUMN IF NOT EXISTS episode_uuid TEXT;
ALTER TABLE memory_episodes ADD COLUMN IF NOT EXISTS group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_episodes_uuid ON memory_episodes (episode_uuid);
CREATE INDEX IF NOT EXISTS idx_episodes_group ON memory_episodes (group_id);
