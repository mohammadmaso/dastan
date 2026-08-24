import type { Db } from '../db/index.js';
import type { MemoryService } from '../memory/memory-service.js';
import type {
  StoryPreferenceInput,
  StoryPreferenceVersion,
  StoryPreferences,
} from '@storywriter/types';

export class PreferenceService {
  constructor(
    private db: Db,
    private memory?: MemoryService,
  ) {}

  async getLatest(storyId: string): Promise<StoryPreferenceVersion | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM story_preferences WHERE story_id = $1 ORDER BY version DESC LIMIT 1',
      [storyId],
    );
    if (!rows[0]) return null;
    return this.map(rows[0]);
  }

  private map(row: Record<string, unknown>): StoryPreferenceVersion {
    return {
      id: String(row.id),
      storyId: String(row.story_id),
      preferences: row.preferences as StoryPreferences,
      note: (row.note as string | null) ?? null,
      version: Number(row.version),
      createdAt: String(row.created_at),
    };
  }

  /** Persist a new version. Only affects future generations. */
  async save(storyId: string, preferences: StoryPreferences, note?: string): Promise<StoryPreferenceVersion> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `INSERT INTO story_preferences (story_id, preferences, note, version)
       VALUES ($1, $2, $3, COALESCE(
         (SELECT max(version) FROM story_preferences WHERE story_id = $1), 0) + 1)
       RETURNING *`,
      [storyId, JSON.stringify(preferences), note ?? null],
    );
    const saved = this.map(rows[0]);
    // ponytail: Graphiti world ingest is slow (~1–2min); Postgres is source of truth.
    void this.memory?.ingestWorld(storyId, preferences).catch((err) => {
      console.warn('[prefs] world ingest skipped', (err as Error).message);
    });
    return saved;
  }

  async history(storyId: string): Promise<StoryPreferenceVersion[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM story_preferences WHERE story_id = $1 ORDER BY version ASC',
      [storyId],
    );
    return rows.map((r) => this.map(r));
  }
}

export type { StoryPreferenceInput };
