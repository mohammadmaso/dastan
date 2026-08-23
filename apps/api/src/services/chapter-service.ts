import type { Db } from '../db/index.js';
import { rowToCamel } from '../db/index.js';
import type { Chapter } from '@storywriter/types';
import { NotFoundError } from './story-service.js';

export class ChapterService {
  constructor(private db: Db) {}

  async listByStory(storyId: string): Promise<Chapter[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM chapters WHERE story_id = $1 ORDER BY "order" ASC',
      [storyId],
    );
    return rows.map((r) => rowToCamel(r) as unknown as Chapter);
  }

  async listByBranch(branchId: string): Promise<Chapter[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM chapters WHERE branch_id = $1 ORDER BY "order" ASC',
      [branchId],
    );
    return rows.map((r) => rowToCamel(r) as unknown as Chapter);
  }

  async get(id: string): Promise<Chapter> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM chapters WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw new NotFoundError('Chapter not found');
    return rowToCamel(rows[0]) as unknown as Chapter;
  }

  async create(storyId: string, branchId: string, title: string): Promise<Chapter> {
    const nextOrder = await this.nextOrder(branchId);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `INSERT INTO chapters (story_id, branch_id, title, "order")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [storyId, branchId, title, nextOrder],
    );
    return rowToCamel(rows[0]) as unknown as Chapter;
  }

  async rename(id: string, title: string): Promise<Chapter> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'UPDATE chapters SET title = $2 WHERE id = $1 RETURNING *',
      [id, title],
    );
    if (!rows[0]) throw new NotFoundError('Chapter not found');
    return rowToCamel(rows[0]) as unknown as Chapter;
  }

  private async nextOrder(branchId: string): Promise<number> {
    const { rows } = await this.db.query<{ max: string | null }>(
      'SELECT max("order")::text AS max FROM chapters WHERE branch_id = $1',
      [branchId],
    );
    return (Number(rows[0]?.max ?? 0)) + 1;
  }
}
