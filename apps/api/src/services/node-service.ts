import type { Db } from '../db/index.js';
import type {
  Chapter,
  CreateNodeInput,
  StoryNode,
  UpdateNodeInput,
} from '@storywriter/types';
import { NotFoundError } from './story-service.js';
import type { MemoryService } from '../memory/memory-service.js';
import type { ChapterService } from './chapter-service.js';

export class NodeService {
  constructor(
    private db: Db,
    private chapters: ChapterService,
    private memory: MemoryService,
  ) {}

  // ---- mapping -------------------------------------------------------------
  private map(row: Record<string, unknown>): StoryNode {
    return {
      id: String(row.id),
      storyId: String(row.story_id),
      branchId: String(row.branch_id),
      parentNodeId: row.parent_node_id ? String(row.parent_node_id) : null,
      position: Number(row.position),
      content: String(row.content ?? ''),
      nodeType: row.node_type as StoryNode['nodeType'],
      author: row.author as StoryNode['author'],
      continuationLabel: row.continuation_label ? String(row.continuation_label) : null,
      isCurrent: Boolean(row.is_current),
      chapterId: row.chapter_id ? String(row.chapter_id) : null,
      chapterTitle: row.chapter_title ? String(row.chapter_title) : null,
      generationMetadata: (row.generation_metadata as StoryNode['generationMetadata']) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private async queryNode(id: string): Promise<StoryNode> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM story_nodes WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw new NotFoundError('Node not found');
    return this.map(rows[0]);
  }

  // ---- queries -------------------------------------------------------------
  async listByBranch(branchId: string): Promise<StoryNode[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM story_nodes WHERE branch_id = $1 ORDER BY position ASC, created_at ASC',
      [branchId],
    );
    return rows.map((r) => this.map(r));
  }

  async get(id: string): Promise<StoryNode> {
    return this.queryNode(id);
  }

  /** The last N nodes of a branch (configurable local context). */
  async recentNodes(branchId: string, count: number): Promise<StoryNode[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM story_nodes WHERE branch_id = $1
       ORDER BY position DESC LIMIT $2`,
      [branchId, count],
    );
    return rows.map((r) => this.map(r)).reverse();
  }

  async current(branchId: string): Promise<StoryNode | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM story_nodes WHERE branch_id = $1 AND is_current = TRUE LIMIT 1`,
      [branchId],
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  // ---- writes --------------------------------------------------------------
  async createRoot(storyId: string, branchId: string): Promise<StoryNode> {
    return this.create({
      branchId,
      parentNodeId: null,
      content: '',
      nodeType: 'ROOT',
      author: 'system',
      makeCurrent: true,
    });
  }

  async create(input: CreateNodeInput, opts: { skipMemory?: boolean } = {}): Promise<StoryNode> {
    const { branchId, parentNodeId } = input;
    const branch = await this.branchOf(branchId);

    // Resolve position + inherited chapter.
    let position = 0;
    let chapterId: string | null = null;
    let chapterTitle: string | null = null;
    if (parentNodeId) {
      const parent = await this.queryNode(parentNodeId);
      if (parent.branchId === branchId) {
        position = parent.position + 1;
        chapterId = parent.chapterId;
        chapterTitle = parent.chapterTitle;
      } else {
        position = await this.branchNodeCount(branchId);
      }
    } else {
      position = await this.branchNodeCount(branchId);
    }

    const nodeType = input.nodeType ?? 'AI_GENERATED';
    const author = input.author ?? (nodeType === 'USER_WRITTEN' ? 'user' : 'ai');
    const makeCurrent = input.makeCurrent ?? false;

    const { rows } = await this.db.query<Record<string, unknown>>(
      `INSERT INTO story_nodes
         (story_id, branch_id, parent_node_id, position, content, node_type, author,
          continuation_label, is_current, chapter_id, chapter_title)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        branch.story_id,
        branchId,
        parentNodeId ?? null,
        position,
        input.content ?? '',
        nodeType,
        author,
        input.continuationLabel ?? null,
        makeCurrent,
        chapterId,
        chapterTitle,
      ],
    );

    if (makeCurrent) {
      await this.setCurrent(branchId, String(rows[0].id));
    }
    const node = this.map(rows[0]);

    // Add to episodic memory (unless explicitly skipped, e.g. duplication).
    if (!opts.skipMemory && node.content.trim() && node.nodeType !== 'ROOT') {
      try {
        await this.memory.addNodeEpisode(node);
      } catch (err) {
        console.error('[node] memory add failed (non-fatal)', (err as Error).message);
      }
    }
    return node;
  }

  async update(id: string, input: UpdateNodeInput): Promise<StoryNode> {
    const existing = await this.queryNode(id);
    const contentChanged =
      input.content !== undefined && input.content !== existing.content;

    let chapterId = input.chapterId !== undefined ? input.chapterId : existing.chapterId;
    // Keep chapter title in sync if only chapterId is given.
    let chapterTitle = input.chapterId ? existing.chapterTitle : existing.chapterTitle;

    const { rows } = await this.db.query<Record<string, unknown>>(
      `UPDATE story_nodes SET
         content = COALESCE($2, content),
         node_type = COALESCE($3, node_type),
         continuation_label = COALESCE($4, continuation_label),
         is_current = COALESCE($5, is_current),
         chapter_id = COALESCE($6, chapter_id),
         chapter_title = COALESCE($7, chapter_title),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        input.content ?? null,
        input.nodeType ?? null,
        input.continuationLabel !== undefined ? input.continuationLabel : null,
        input.isCurrent ?? null,
        chapterId,
        chapterTitle,
      ],
    );
    if (!rows[0]) throw new NotFoundError('Node not found');

    if (input.isCurrent === true) {
      await this.setCurrent(existing.branchId, id);
    }

    // Reconcile memory when content changed.
    if (contentChanged && String((rows[0] as { content?: string }).content ?? '').trim()) {
      try {
        await this.memory.reconcileNode(existing, this.map(rows[0]));
      } catch (err) {
        console.error('[node] memory reconcile failed (non-fatal)', (err as Error).message);
      }
    }
    return this.map(rows[0]);
  }

  async setCurrent(branchId: string, nodeId: string): Promise<void> {
    await this.db.query(`UPDATE story_nodes SET is_current = FALSE WHERE branch_id = $1`, [branchId]);
    await this.db.query(`UPDATE story_nodes SET is_current = TRUE WHERE id = $1`, [nodeId]);
  }

  async remove(id: string): Promise<void> {
    const node = await this.queryNode(id).catch(() => null);
    if (node) {
      try {
        await this.memory.removeNodeEpisodes(node);
      } catch (err) {
        console.error('[node] memory remove failed (non-fatal)', (err as Error).message);
      }
    }
    await this.db.query('DELETE FROM story_nodes WHERE id = $1', [id]);
  }

  // ---- chapter boundaries --------------------------------------------------
  /** Mark a node as a chapter boundary: create a Chapter and reassign the node
   *  and all following in-branch nodes to it. Purely organizational. */
  async createChapterBoundary(
    storyId: string,
    branchId: string,
    nodeId: string,
    title: string,
  ): Promise<Chapter> {
    const chapter = await this.chapters.create(storyId, branchId, title);
    const node = await this.queryNode(nodeId);
    await this.db.query(
      `UPDATE story_nodes SET chapter_id = $1, chapter_title = $2
       WHERE branch_id = $3 AND position >= $4`,
      [chapter.id, chapter.title, branchId, node.position],
    );
    return chapter;
  }

  // ---- helpers -------------------------------------------------------------
  private async branchOf(branchId: string) {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM branches WHERE id = $1',
      [branchId],
    );
    if (!rows[0]) throw new NotFoundError('Branch not found');
    return rows[0] as unknown as { id: string; story_id: string };
  }

  private async branchNodeCount(branchId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM story_nodes WHERE branch_id = $1',
      [branchId],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
