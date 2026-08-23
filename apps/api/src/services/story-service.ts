import type { Db } from '../db/index.js';
import { rowToCamel } from '../db/index.js';
import type {
  CreateStoryInput,
  Story,
  StorySummary,
  UpdateStoryInput,
} from '@storywriter/types';
import type { BranchService } from './branch-service.js';
import type { PreferenceService } from './preference-service.js';
import type { NodeService } from './node-service.js';

export class StoryService {
  constructor(
    private db: Db,
    private branches: BranchService,
    private nodes: NodeService,
    private preferences: PreferenceService,
  ) {}

  async create(input: CreateStoryInput): Promise<Story> {
    const genre = input.genre ?? input.preferences?.preferences.genre ?? null;
    const { rows } = await this.db.query<Record<string, unknown>>(
      `INSERT INTO stories (title, description, genre)
       VALUES ($1, $2, $3) RETURNING *`,
      [input.title, input.description ?? null, genre ?? null],
    );
    const story = rowToCamel(rows[0]) as unknown as Story;

    // A story always starts with a default branch + ROOT node.
    const branch = await this.branches.create(story.id, { name: 'Main Line' });
    await this.nodes.createRoot(story.id, branch.id);

    if (input.preferences) {
      await this.preferences.save(story.id, input.preferences.preferences, input.preferences.note);
    }

    return story;
  }

  async list(): Promise<StorySummary[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT s.*,
              (SELECT count(*) FROM story_nodes n WHERE n.story_id = s.id)::int AS node_count,
              (SELECT count(*) FROM branches b WHERE b.story_id = s.id)::int AS branch_count,
              (SELECT count(*) FROM chapters c WHERE c.story_id = s.id)::int AS chapter_count
       FROM stories s
       ORDER BY s.updated_at DESC`,
    );
    return rows.map((r) => rowToCamel(r) as unknown as StorySummary);
  }

  async get(id: string): Promise<Story> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM stories WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw new NotFoundError('Story not found');
    return rowToCamel(rows[0]) as unknown as Story;
  }

  async update(id: string, input: UpdateStoryInput): Promise<Story> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `UPDATE stories SET
         title = COALESCE($2, title),
         description = CASE WHEN $3::boolean THEN $4 ELSE description END,
         genre = COALESCE($5, genre),
         status = COALESCE($6, status),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        input.title ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.genre ?? null,
        input.status ?? null,
      ],
    );
    if (!rows[0]) throw new NotFoundError('Story not found');
    return rowToCamel(rows[0]) as unknown as Story;
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM stories WHERE id = $1', [id]);
  }

  /** Duplicate a story, its preferences, branches and nodes. Memory not copied. */
  async duplicate(id: string): Promise<Story> {
    const source = await this.get(id);
    const prefs = await this.preferences.getLatest(id);

    const created = await this.create({
      title: `${source.title} (Copy)`,
      description: source.description,
      genre: source.genre,
      preferences: prefs ? { preferences: prefs.preferences } : undefined,
    });

    // Copy nodes across branches.
    const sourceBranches = await this.branches.listByStory(id);
    const branchIdMap = new Map<string, string>();
    for (const b of sourceBranches) {
      const copied = await this.branches.create(created.id, { name: b.name });
      branchIdMap.set(b.id, copied.id);
    }
    for (const b of sourceBranches) {
      const newBranchId = branchIdMap.get(b.id)!;
      const nodes = await this.nodes.listByBranch(b.id);
      const nodeIdMap = new Map<string, string>();
      // clean the copied empty ROOT (first node of original branch)
      const first = nodes[0];
      if (first) {
        const root = await this.nodes.create({
          branchId: newBranchId,
          parentNodeId: null,
          content: first.content,
          nodeType: 'ROOT',
          author: first.author as any,
          makeCurrent: first.isCurrent,
        });
        nodeIdMap.set(first.id, root.id);
        for (const n of nodes.slice(1)) {
          const createdNode = await this.nodes.create({
            branchId: newBranchId,
            parentNodeId: nodeIdMap.get(n.parentNodeId ?? '') ?? null,
            content: n.content,
            nodeType: n.nodeType === 'ROOT' ? 'AI_GENERATED' : n.nodeType,
            author: n.author as any,
            continuationLabel: n.continuationLabel,
            makeCurrent: n.isCurrent,
          });
          nodeIdMap.set(n.id, createdNode.id);
        }
      }
    }
    return created;
  }
}

export class NotFoundError extends Error {}

/** convenience export so clients can construct typed errors */
export { NotFoundError as StoryNotFound };
