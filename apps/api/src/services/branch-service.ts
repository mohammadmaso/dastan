import type { Db } from '../db/index.js';
import { rowToCamel } from '../db/index.js';
import type { Branch, CreateBranchInput, UpdateBranchInput } from '@storywriter/types';
import { NotFoundError } from './story-service.js';

export class BranchService {
  constructor(private db: Db) {}

  async listByStory(storyId: string): Promise<Branch[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM branches WHERE story_id = $1 ORDER BY created_at ASC',
      [storyId],
    );
    return rows.map((r) => rowToCamel(r) as unknown as Branch);
  }

  async get(id: string): Promise<Branch> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM branches WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw new NotFoundError('Branch not found');
    return rowToCamel(rows[0]) as unknown as Branch;
  }

  async create(storyId: string, input: CreateBranchInput = {}): Promise<Branch> {
    const count = await this.defaultNameCount(storyId);
    const name =
      input.name ?? (count === 0 ? 'Main Line' : `Branch ${count + 1}`);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `INSERT INTO branches (story_id, parent_branch_id, fork_node_id, name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [storyId, input.parentBranchId ?? null, input.forkNodeId ?? null, name],
    );
    return rowToCamel(rows[0]) as unknown as Branch;
  }

  private async defaultNameCount(storyId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM branches WHERE story_id = $1',
      [storyId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async update(id: string, input: UpdateBranchInput): Promise<Branch> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `UPDATE branches SET
         name = COALESCE($2, name),
         status = COALESCE($3, status),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, input.name ?? null, input.status ?? null],
    );
    if (!rows[0]) throw new NotFoundError('Branch not found');
    return rowToCamel(rows[0]) as unknown as Branch;
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM branches WHERE id = $1', [id]);
  }

  /** Create a duplicate of a branch (a forked copy with its own IDs and memory namespace). */
  async duplicate(id: string): Promise<Branch> {
    const source = await this.get(id);
    const copy = await this.db.query<Record<string, unknown>>(
      `INSERT INTO branches (story_id, parent_branch_id, name, status)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [source.storyId, source.parentBranchId, `${source.name} (Copy)`, source.status as string],
    );
    return rowToCamel(copy.rows[0]) as unknown as Branch;
  }
}
