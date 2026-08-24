// MemoryService implements the episodic/semantic memory pattern described by
// Graphiti, backed by PostgreSQL (episodes + embeddings for retrieval) and
// FalkorDB (the knowledge graph of entities, relationships and their source
// episodes). Everything is scoped by story_id and branch_id so branches stay
// isolated and global story facts remain shareable.

import type { Db } from '../db/index.js';
import { MemoryScope } from '@storywriter/types';
import type { StoryNode, MemoryGraph, MemoryEntity, MemoryRelationship } from '@storywriter/types';
import { FalkorDB } from './falkordb.js';
import { EmbeddingProvider, cosine } from './embeddings.js';
import { chat } from '../llm/client.js';
import { EXTRACT_SYSTEM } from '../llm/prompts.js';
import type { SettingsService } from '../services/settings-service.js';

export type ActivityEmitter = (
  type: 'searching_memory' | 'search_intent' | 'memory_found' | 'reviewing_recent',
  message?: string,
  query?: string,
  scope?: string,
) => void;

interface EpisodeRow {
  id: string;
  story_id: string;
  branch_id: string | null;
  node_id: string | null;
  name: string;
  body: string;
  // pg parses REAL[] columns into a JS number[] automatically.
  embedding: string | number[] | null;
}

const embedArr = (arr: number[]) => `{${arr.join(',')}}`;

function parseEmbedding(value: string | number[] | null): number[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(Number);
  const inner = String(value).replace(/^\{|\}$/g, '').trim();
  if (!inner) return null;
  return inner.split(',').map(Number);
}

export class MemoryService {
  private embeddings: EmbeddingProvider;

  constructor(
    private db: Db,
    private falkordb: FalkorDB,
    private settings: SettingsService,
  ) {
    this.embeddings = new EmbeddingProvider(async () => {
      const c = await this.settings.callOptions();
      return {
        baseUrl: c.baseUrl,
        apiKey: c.apiKey,
        model: c.embeddingModel,
        enabled: c.embeddingEnabled,
      };
    });
  }

  async warmup(): Promise<void> {
    try {
      await this.falkordb.ensureSchema();
    } catch (err) {
      console.warn('[memory] schema init skipped', (err as Error).message);
    }
  }

  // =========================================================================
  // Writes
  // =========================================================================

  /** Add a story node as an episode (memory), extracting entities/relationships. */
  async addNodeEpisode(node: StoryNode): Promise<void> {
    // 1) store episode + embedding in postgres
    //    (uses the configured embedding model + enable flag; falls back to
    //     local hashed vectors when embeddings are disabled or unavailable)
    const [emb] = await this.embeddings.embed(node.content);
    await this.db.query(
      `INSERT INTO memory_episodes (story_id, branch_id, node_id, name, body, embedding)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [node.storyId, node.branchId, node.id, `story_node_${node.id}`, node.content, embedArr(emb)],
    );

    // 2) best-effort entity extraction into the FalkorDB knowledge graph
    try {
      const { baseUrl, apiKey, model } = await this.settings.callOptions();
      const result = await chat({ baseUrl, apiKey, model, jsonMode: true, temperature: 0.2 }, [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: node.content },
      ]);
      const json = safeJson(result.text);
      if (!json) return;

      const entities: Array<{ name: string; type: string }> = json.entities ?? [];
      const relationships: Array<{ source: string; type: string; target: string }> =
        json.relationships ?? [];
      const summary: string = json.summary ?? node.content.slice(0, 200);
      const names = entities.map((e) => e.name);

      for (const e of entities.slice(0, 40)) {
        await this.falkordb.upsertEntity(e.name, e.type || 'other', node.storyId, node.branchId);
      }
      for (const r of relationships.slice(0, 40)) {
        await this.falkordb.addRelationship(r.source, r.type, r.target, node.storyId, node.branchId, summary);
      }
      await this.falkordb.addEpisode(`story_node_${node.id}`, summary, node.storyId, node.branchId, names);
    } catch (err) {
      console.warn('[memory] entity extraction skipped', (err as Error).message);
    }
  }

  /** Reconcile memory after a node is edited: supersede the old episode and re-extract. */
  async reconcileNode(oldNode: StoryNode, newNode: StoryNode): Promise<void> {
    // mark existing episode superseded via a new revision episode
    try {
      await this.addNodeEpisode(newNode);
      await this.falkordb.runSupersede(`story_node_${newNode.id}`, `story_node_${oldNode.id}:rev`);
    } catch (err) {
      console.warn('[memory] reconcile partial', (err as Error).message);
    }
  }

  async removeNodeEpisodes(node: StoryNode): Promise<void> {
    if (!node) return;
    try {
      await this.db.query(
        `DELETE FROM memory_episodes WHERE node_id = $1`,
        [node.id],
      );
      await this.falkordb.removeEpisode(`story_node_${node.id}`);
    } catch (err) {
      console.warn('[memory] teardown partial', (err as Error).message);
    }
  }

  // =========================================================================
  // Retrieval
  // =========================================================================

  async retrieve(
    params: {
      storyId: string;
      branchId: string;
      query: string;
      scopes: MemoryScope[];
      depth: number;
      emit?: ActivityEmitter;
      /** Lineage branches (e.g. a forked branch's parent) to include in BRANCH scope. */
      relatedBranches?: string[];
      /** Skip the LLM intent-planning step and search the raw query directly. */
      skipPlanning?: boolean;
    },
  ): Promise<{ memories: Array<{ text: string; score: number; scope: MemoryScope; meta?: string }> }> {
    const { storyId, branchId, query, depth, emit } = params;
    const relatedBranches = params.relatedBranches ?? [];
    const scopes = params.scopes.length ? params.scopes : [MemoryScope.BRANCH, MemoryScope.GLOBAL];
    emit?.('searching_memory', 'Searching story memory...');

    const gathered: Array<{ text: string; score: number; scope: MemoryScope; meta?: string }> = [];
    const seen = new Set<string>();

    const add = (text: string, score: number, scope: MemoryScope, meta?: string) => {
      const key = scope + '|' + text.slice(0, 40);
      if (seen.has(key)) return;
      seen.add(key);
      gathered.push({ text, score, scope, meta });
    };

    // 1) plan search intents — unless skipped (direct search on the raw query).
    const intents = params.skipPlanning
      ? [{ query, scope: MemoryScope.BRANCH }]
      : await this.planIntents(query, storyId, branchId, emit);

    // 2) run each intent
    for (const intent of intents.slice(0, 6)) {
      emit?.('search_intent', 'Looking for:', intent.query, intent.scope);
      const results = await this.retrieveOne(intent.query, storyId, branchId, intent.scope, depth, relatedBranches);
      for (const r of results) add(r.text, r.score, r.scope, r.meta);
    }

    // 3) direct semantic search on the raw query too
    const direct = await this.retrieveOne(query, storyId, branchId, MemoryScope.BRANCH, depth, relatedBranches);
    for (const r of direct) add(r.text, r.score, r.scope, r.meta);

    gathered.sort((a, b) => b.score - a.score);
    return { memories: gathered.slice(0, Math.max(depth * 2, 6)) };
  }

  private async planIntents(
    query: string,
    storyId: string,
    branchId: string,
    emit?: ActivityEmitter,
  ): Promise<Array<{ query: string; scope: MemoryScope }>> {
    try {
      const call = await this.settings.callOptions();
      const result = await chat(
        { ...call, jsonMode: true, temperature: 0.2, maxTokens: 600 },
        [
          { role: 'system', content: `You are a story retrieval planner for a branch of a story. Decide the specific facts needed to continue coherently. Return STRICT JSON {"intents":[{"query":"...","scope":"CURRENT_BRANCH_MEMORY"|"GLOBAL_STORY_MEMORY"}]} with 2-4 intents.` },
          { role: 'user', content: `Writer's direction: ${query}` },
        ],
      );
      const json = safeJson(result.text);
      const intents = (json?.intents ?? []).map((i: any) => ({
        query: String(i.query ?? ''),
        scope: i.scope === 'GLOBAL_STORY_MEMORY' ? MemoryScope.GLOBAL : MemoryScope.BRANCH,
      }));
      return intents.filter((i: any) => i.query.length > 0);
    } catch {
      return [{ query, scope: MemoryScope.BRANCH }];
    }
  }

  private async retrieveOne(
    query: string,
    storyId: string,
    branchId: string,
    scope: MemoryScope,
    depth: number,
    relatedBranches: string[] = [],
  ): Promise<Array<{ text: string; score: number; scope: MemoryScope; meta?: string }>> {
    const out: Array<{ text: string; score: number; scope: MemoryScope; meta?: string }> = [];

    // A) semantic search over episodes (postgres embeddings)
    const [qemb] = await this.embeddings.embed(query);
    let branchClause: string;
    const params: unknown[] = [storyId];
    if (scope === MemoryScope.GLOBAL) {
      branchClause = 'AND branch_id IS NULL';
    } else if (relatedBranches.length) {
      branchClause = 'AND (branch_id = $2 OR branch_id = ANY($3::uuid[]))';
      params.push(branchId, relatedBranches);
    } else {
      branchClause = 'AND branch_id = $2';
      params.push(branchId);
    }
    const { rows } = await this.db.query<EpisodeRow>(
      `SELECT id, name, body, embedding FROM memory_episodes
       WHERE story_id = $1 ${branchClause}
       ORDER BY created_at DESC LIMIT 200`,
      params,
    );
    const scored = rows
      .map((row) => {
        const emb = parseEmbedding(row.embedding);
        return { row, sim: emb ? cosine(qemb, emb) : 0 };
      })
      .filter((x) => x.sim >= 0.1)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, depth ?? 5);
    for (const s of scored) {
      out.push({
        text: s.row.body,
        score: s.sim,
        scope,
        meta: 'episode',
      });
    }

    // B) graph expansion: detect entities mentioned in the query and pull neighbors
    try {
      const names = await this.detectEntities(query, storyId, branchId);
      if (names.length) {
        const scopeArg = scope === MemoryScope.GLOBAL ? null : branchId;
        const { relationships } = await this.falkordb.neighbors(names, storyId, scopeArg as string | null | 'any');
        const relText = relationships
          .filter((r) => (scope === MemoryScope.GLOBAL ? !r.branchId : true))
          .slice(0, 25)
          .map((r) => `${r.source} --${r.type}--> ${r.target}`);
        if (relText.length) {
          out.push({
            text: `Known relationships: ${[...new Set(relText)].join('; ')}`,
            score: 0.5,
            scope,
            meta: 'entity',
          });
        }
        const eps = await this.falkordb.episodesForEntities(names, storyId, scope === MemoryScope.GLOBAL ? null : branchId);
        for (const e of eps.slice(0, 10)) {
          out.push({ text: e.summary, score: 0.5, scope, meta: 'episode' });
        }
      }
    } catch {
      /* graph unavailable */
    }

    return out;
  }

  private async detectEntities(query: string, storyId: string, branchId: string): Promise<string[]> {
    try {
      const { entities } = await this.falkordb.fullGraph(storyId, branchId);
      const q = query.toLowerCase();
      return entities
        .map((e) => e.name)
        .filter((name) => name && name.length >= 2 && q.includes(name.toLowerCase()))
        .slice(0, 8);
    } catch {
      return [];
    }
  }

  // =========================================================================
  // Graph read API (for the knowledge-graph viewer)
  // =========================================================================

  async getGraph(storyId: string, branchId: string | null): Promise<MemoryGraph> {
    const { entities, relationships } = await this.falkordb.fullGraph(storyId, branchId);
    const ent: MemoryEntity[] = entities.map((e) => ({
      id: `e:${e.name}`,
      name: e.name,
      type: e.type,
    }));
    const rel: MemoryRelationship[] = relationships.map((r, i) => ({
      id: `r:${i}`,
      source: r.source,
      target: r.target,
      type: r.type,
      summary: r.summary,
    }));
    return { storyId, branchId, entities: ent, relationships: rel };
  }

  async inMemory(name: string, storyId: string): Promise<string | null> {
    const { entities } = await this.falkordb.fullGraph(storyId, 'any');
    return entities.find((e) => e.name.toLowerCase() === name.toLowerCase())?.type ?? null;
  }
}

function safeJson(text: string): any {
  try {
    const cleaned = text.replace(/```/g, '').replace(/^json/i, '').trim();
    // find first { .. last }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}
