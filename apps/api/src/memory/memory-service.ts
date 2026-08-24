// Thin typed client over the Graphiti sidecar. Every write/search is scoped
// by group_id (world vs per-branch). When the sidecar is down, writes are
// skipped and search returns nothing — narrative state in Postgres is never lost.

import type { Db } from '../db/index.js';
import { MemoryScope } from '@storywriter/types';
import type { MemoryGraph, StoryNode, StoryPreferences } from '@storywriter/types';
import type { AppConfig } from '../config.js';
import type { SettingsService } from '../services/settings-service.js';
import { branchGroup, keepFact, worldGroup, type MemoryFact } from './groups.js';
import { preferencesToPrompt } from '../llm/prompts.js';

export type ActivityEmitter = (
  type: 'searching_memory' | 'search_intent' | 'memory_found' | 'reviewing_recent',
  message?: string,
  query?: string,
  scope?: string,
) => void;

export interface LlmOpts {
  base_url: string;
  api_key: string;
  model: string;
  embedding_model: string;
}

interface SearchHit {
  uuid?: string;
  fact: string;
  group_id?: string | null;
  episodes?: string[];
  score?: number | null;
  source_node_uuid?: string | null;
  name?: string | null;
}

interface NodeHit {
  uuid?: string;
  name: string;
  summary?: string;
  labels?: string[];
  group_id?: string | null;
}

export class MemoryService {
  constructor(
    private db: Db,
    private config: AppConfig,
    private settings: SettingsService,
  ) {}

  get available(): boolean {
    return true;
  }

  async ping(): Promise<boolean> {
    try {
      const r = await fetch(`${this.config.memory.url}/health`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  async warmup(): Promise<void> {
    try {
      await fetch(`${this.config.memory.url}/admin/build-indices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.warn('[memory] warmup skipped', (err as Error).message);
    }
  }

  private async llmOpts(): Promise<LlmOpts> {
    const c = await this.settings.callOptions();
    return {
      base_url: c.baseUrl,
      api_key: c.apiKey,
      model: c.model,
      embedding_model: c.embeddingModel,
    };
  }

  // =========================================================================
  // Writes
  // =========================================================================

  async ingestWorld(storyId: string, preferences: StoryPreferences): Promise<void> {
    const body = preferencesToPrompt(preferences);
    if (!body.trim()) return;
    try {
      const res = await this.addEpisode({
        name: `story_world_${storyId}`,
        episode_body: body,
        source_description: 'story preferences / world bible',
        group_id: worldGroup(storyId),
      });
      if (res?.uuid) {
        await this.db.query(
          `INSERT INTO memory_episodes (story_id, branch_id, node_id, name, episode_uuid, group_id)
           VALUES ($1, NULL, NULL, $2, $3, $4)`,
          [storyId, `story_world_${storyId}`, res.uuid, worldGroup(storyId)],
        );
      }
    } catch (err) {
      console.warn('[memory] world ingest skipped', (err as Error).message);
    }
  }

  async addNodeEpisode(node: StoryNode): Promise<void> {
    if (!node.content.trim() || node.nodeType === 'ROOT') return;
    const groupId = branchGroup(node.storyId, node.branchId);
    try {
      const res = await this.addEpisode({
        name: `story_node_${node.id}`,
        episode_body: node.content,
        source_description: `story node ${node.id}`,
        group_id: groupId,
      });
      if (res?.uuid) {
        await this.db.query(
          `INSERT INTO memory_episodes (story_id, branch_id, node_id, name, episode_uuid, group_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [node.storyId, node.branchId, node.id, `story_node_${node.id}`, res.uuid, groupId],
        );
      }
    } catch (err) {
      console.warn('[memory] add episode skipped', (err as Error).message);
    }
  }

  async reconcileNode(_oldNode: StoryNode, newNode: StoryNode): Promise<void> {
    await this.removeNodeEpisodes(newNode);
    await this.addNodeEpisode(newNode);
  }

  async removeNodeEpisodes(node: StoryNode): Promise<void> {
    try {
      const { rows } = await this.db.query<{ episode_uuid: string | null }>(
        `SELECT episode_uuid FROM memory_episodes WHERE node_id = $1 AND episode_uuid IS NOT NULL`,
        [node.id],
      );
      for (const row of rows) {
        if (row.episode_uuid) await this.deleteEpisode(row.episode_uuid);
      }
      await this.db.query(`DELETE FROM memory_episodes WHERE node_id = $1`, [node.id]);
    } catch (err) {
      console.warn('[memory] teardown partial', (err as Error).message);
    }
  }

  // =========================================================================
  // Retrieval
  // =========================================================================

  async retrieve(params: {
    storyId: string;
    branchId: string;
    query: string;
    scopes?: MemoryScope[];
    depth?: number;
    emit?: ActivityEmitter;
    relatedBranches?: string[];
    allowedEpisodeUuids?: string[];
  }): Promise<{ memories: Array<{ text: string; score: number; scope: MemoryScope; meta?: string; groupId?: string }> }> {
    const { storyId, branchId, query, emit } = params;
    const depth = params.depth ?? 5;
    emit?.('searching_memory', 'Searching story memory...');

    const world = worldGroup(storyId);
    const own = branchGroup(storyId, branchId);
    const ancestors = (params.relatedBranches ?? []).map((id) => branchGroup(storyId, id));
    const groupIds = [world, own, ...ancestors];

    emit?.('search_intent', 'Looking for:', query, MemoryScope.BRANCH);

    let hits: SearchHit[] = [];
    try {
      hits = await this.search(query, groupIds, depth * 4);
    } catch (err) {
      console.warn('[memory] search failed', (err as Error).message);
    }

    const ctx = {
      worldGroup: world,
      branchGroup: own,
      ancestorGroups: ancestors,
      allowedEpisodeUuids: new Set(params.allowedEpisodeUuids ?? []),
    };

    const gathered: Array<{ text: string; score: number; scope: MemoryScope; meta?: string; groupId?: string }> = [];
    const seen = new Set<string>();
    for (const h of hits) {
      const fact: MemoryFact = {
        uuid: h.uuid,
        fact: h.fact,
        groupId: h.group_id ?? null,
        episodeUuids: h.episodes ?? [],
        score: h.score,
        sourceNodeUuid: h.source_node_uuid,
      };
      if (!keepFact(fact, ctx)) continue;
      const key = fact.fact.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      const scope = fact.groupId === world ? MemoryScope.GLOBAL : MemoryScope.BRANCH;
      gathered.push({
        text: fact.fact,
        score: typeof h.score === 'number' ? h.score : 0.5,
        scope,
        meta: 'graphiti',
        groupId: fact.groupId ?? undefined,
      });
    }

    if (gathered.length) emit?.('memory_found', `${gathered.length} relevant memories retrieved for context.`);
    gathered.sort((a, b) => b.score - a.score);
    return { memories: gathered.slice(0, Math.max(depth * 2, 6)) };
  }

  async searchNodes(query: string, groupIds: string[], limit = 8): Promise<NodeHit[]> {
    const llm = await this.llmOpts();
    const r = await this.post('/search/nodes', {
      query,
      group_ids: groupIds,
      num_results: limit,
      llm,
    });
    return (r.nodes ?? []) as NodeHit[];
  }

  async search(query: string, groupIds: string[], limit = 10, center?: string): Promise<SearchHit[]> {
    const llm = await this.llmOpts();
    const r = await this.post('/search', {
      query,
      group_ids: groupIds,
      center_node_uuid: center ?? null,
      num_results: limit,
      llm,
    });
    return (r.results ?? []) as SearchHit[];
  }

  async getGraph(storyId: string, branchId: string | null): Promise<MemoryGraph> {
    const ids = [worldGroup(storyId)];
    if (branchId && branchId !== 'any') ids.push(branchGroup(storyId, branchId));
    else {
      const { rows } = await this.db.query<{ id: string }>(
        `SELECT id FROM branches WHERE story_id = $1`,
        [storyId],
      );
      for (const row of rows) ids.push(branchGroup(storyId, row.id));
    }
    try {
      const r = await this.get(`/graph?group_ids=${encodeURIComponent(ids.join(','))}`);
      const entities = (r.entities ?? []).map((e: any) => ({
        id: String(e.id ?? e.name),
        name: String(e.name ?? ''),
        type: String(e.type ?? 'entity'),
        summary: e.summary ? String(e.summary) : undefined,
      }));
      const relationships = (r.relationships ?? []).map((rel: any, i: number) => ({
        id: String(rel.id ?? `r:${i}`),
        source: String(rel.source ?? ''),
        target: String(rel.target ?? ''),
        sourceId: String(rel.source_id ?? rel.source ?? ''),
        targetId: String(rel.target_id ?? rel.target ?? ''),
        type: String(rel.type ?? 'relates_to'),
        summary: rel.summary ? String(rel.summary) : undefined,
      }));
      return { storyId, branchId, entities, relationships };
    } catch (err) {
      console.warn('[memory] graph read failed', (err as Error).message);
      return { storyId, branchId, entities: [], relationships: [] };
    }
  }

  async entityDetail(storyId: string, name: string, branchId: string | null) {
    const graph = await this.getGraph(storyId, branchId);
    const entity = graph.entities.find((e) => e.name.toLowerCase() === name.toLowerCase()) ?? null;
    const relationships = graph.relationships.filter(
      (r) => r.source.toLowerCase() === name.toLowerCase() || r.target.toLowerCase() === name.toLowerCase(),
    );
    return { entity, relationships, episodes: [] as Array<{ id: string; summary: string; branchId: string | null; at: string }> };
  }

  // =========================================================================
  // HTTP
  // =========================================================================

  private async addEpisode(body: {
    name: string;
    episode_body: string;
    source_description: string;
    group_id: string;
  }): Promise<{ uuid?: string } | null> {
    const llm = await this.llmOpts();
    return this.post('/episodes', { ...body, llm });
  }

  private async deleteEpisode(uuid: string): Promise<void> {
    try {
      await fetch(`${this.config.memory.url}/episodes/${encodeURIComponent(uuid)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      console.warn('[memory] delete episode', (err as Error).message);
    }
  }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.config.memory.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`memory ${path} ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.config.memory.url}${path}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`memory GET ${path} ${res.status}`);
    return res.json();
  }
}
