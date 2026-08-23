// Thin client over FalkorDB's Redis-compatible protocol. FalkorDB exposes a
// Redis server that accepts GRAPH.* commands with a Cypher-like query language.
// All parsing is kept here so callers get simple typed results; on any failure
// the methods return null and consumers degrade gracefully (episode fallback).

import { Redis, Command } from 'ioredis';
import type { AppConfig } from '../config.js';

export interface FalkorEntity {
  name: string;
  type: string;
  branchId: string | null;
}

export interface FalkorRel {
  source: string;
  target: string;
  type: string;
  sourceType?: string;
  targetType?: string;
  branchId: string | null;
  summary?: string;
}

export interface FalkorEpisode {
  id: string;
  summary: string;
  branchId: string | null;
}

const escapeStr = (s: string) => (s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class FalkorDB {
  private client: Redis;
  private graph: string;
  private alive = true;

  constructor(private config: AppConfig) {
    this.graph = config.falkordb.graph;
    this.client = new Redis({
      host: config.falkordb.host,
      port: config.falkordb.port,
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // do not hammer on failure
    });
    this.client.on('error', (err: Error) => {
      this.alive = false;
      console.error('[falkordb] connection error', err.message);
    });
  }

  get available(): boolean {
    return this.alive;
  }

  private async run(query: string): Promise<any[]> {
    // `alive` reflects socket health (toggled by the socket 'error' event), not
    // a failed query. A failing GRAPH.QUERY (e.g. a schema index that already
    // exists) must not mark the database as down.
    try {
      const reply = await this.client.sendCommand(
        new Command('GRAPH.QUERY', [this.graph, query, '--compact'], { replyEncoding: 'utf8' }),
      );
      if (Array.isArray(reply)) {
        this.alive = true;
        return reply;
      }
      return [];
    } catch (err) {
      console.warn('[falkordb] query failed (degrading):', (err as Error).message);
      return [];
    }
  }

  /** Latency/connectivity probe used by the health endpoint. */
  async ping(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      this.alive = pong === 'PONG';
    } catch {
      this.alive = false;
    }
    return this.alive;
  }

  async ensureSchema(): Promise<void> {
    await this.run(`CREATE INDEX FOR (e:Entity) ON (e.name)`);
    await this.run(`CREATE INDEX FOR (e:Episode) ON (e.id)`);
  }

  async upsertEntity(name: string, type: string, storyId: string, branchId: string | null): Promise<void> {
    const bind = branchId ? `'${escapeStr(branchId)}'` : 'null';
    await this.run(
      `MERGE (e:Entity {name:'${escapeStr(name)}'}) SET e.type='${escapeStr(type)}', e.storyId='${escapeStr(storyId)}', e.branchId=${bind}`,
    );
  }

  async addRelationship(
    source: string,
    type: string,
    target: string,
    storyId: string,
    branchId: string | null,
    summary?: string,
  ): Promise<void> {
    const bind = branchId ? `'${escapeStr(branchId)}'` : 'null';
    const summ = summary ? `, r.summary='${escapeStr(summary)}'` : '';
    await this.run(
      `MATCH (a:Entity {name:'${escapeStr(source)}'}), (b:Entity {name:'${escapeStr(target)}'})
       MERGE (a)-[r:REL {type:'${escapeStr(type)}'}]->(b)
       SET r.storyId='${escapeStr(storyId)}', r.branchId=${bind}${summ}`,
    );
  }

  /** Mark a previous episode as superseded by a newer revision. */
  async runSupersede(newEpisode: string, oldEpisode: string): Promise<void> {
    await this.run(
      `MATCH (new:Episode {id:'${escapeStr(newEpisode)}'}), (old:Episode {id:'${escapeStr(oldEpisode)}'})
       MERGE (old)-[:SUPERSEDED_BY]->(new)`,
    );
  }

  async removeEpisode(name: string): Promise<void> {
    await this.run(`MATCH (e:Episode {id:'${escapeStr(name)}'}) DETACH DELETE e`);
  }

  async addEpisode(name: string, summary: string, storyId: string, branchId: string | null, entityNames: string[]): Promise<void> {
    const bind = branchId ? `'${escapeStr(branchId)}'` : 'null';
    await this.run(
      `MERGE (e:Episode {id:'${escapeStr(name)}'}) SET e.summary='${escapeStr(summary)}', e.storyId='${escapeStr(storyId)}', e.branchId=${bind}`,
    );
    for (const en of entityNames) {
      await this.run(
        `MATCH (e:Episode {id:'${escapeStr(name)}'}), (n:Entity {name:'${escapeStr(en)}'})
         MERGE (e)-[:MENTIONS]->(n)`,
      );
    }
  }

  /** Episodes related to the given entities, optionally branch-scoped. */
  async episodesForEntities(
    names: string[],
    storyId: string,
    branchId: string | null | 'any',
  ): Promise<FalkorEpisode[]> {
    if (names.length === 0) return [];
    const nameList = names.map((n) => `'${escapeStr(n)}'`).join(',');
    let scope = '';
    if (branchId !== 'any') {
      const bind = branchId ? `'${escapeStr(branchId)}'` : 'null';
      scope = `AND ep.branchId=${bind}`;
    }
    const result = await this.run(
      `MATCH (ep:Episode)-[:MENTIONS]->(n:Entity) WHERE n.storyId='${escapeStr(storyId)}' ${scope} AND n.name IN [${nameList}]
       RETURN DISTINCT ep.id, ep.summary, ep.branchId`,
    );
    return this.parseEpisodeRows(result);
  }

  /** Neighbor entities + relationships for the given entities, with optional branch scope. */
  async neighbors(
    names: string[],
    storyId: string,
    branchId: string | null | 'any',
  ): Promise<{ entities: FalkorEntity[]; relationships: FalkorRel[]; episodes: FalkorEpisode[] }> {
    if (names.length === 0) return { entities: [], relationships: [], episodes: [] };
    const nameList = names.map((n) => `'${escapeStr(n)}'`).join(',');
    let scope = '';
    if (branchId !== 'any') {
      const bind = branchId ? `'${escapeStr(branchId)}'` : 'null';
      scope = `AND (a.storyId='${escapeStr(storyId)}' OR b.storyId='${escapeStr(storyId)}') AND (r.branchId=${bind})`;
    } else {
      scope = `AND (a.storyId='${escapeStr(storyId)}' OR b.storyId='${escapeStr(storyId)}')`;
    }

    const relResult = await this.run(
      `MATCH (a:Entity)-[r:REL]->(b:Entity)
       WHERE (a.name IN [${nameList}] OR b.name IN [${nameList}]) ${scope}
       RETURN a.name, a.type, r.type, b.name, b.type, r.summary, r.branchId`,
    );
    const rels = this.parseRelRows(relResult);

    const entResult = await this.run(
      `MATCH (n:Entity) WHERE n.storyId='${escapeStr(storyId)}' AND n.name IN [${nameList}]
       RETURN n.name, n.type, n.branchId`,
    );
    const entities = this.parseEntityRows(entResult);

    const episodes = await this.episodesForEntities(names, storyId, branchId);

    return { entities, relationships: rels, episodes };
  }

  /** Full graph for visualization, optionally branch-scoped. */
  async fullGraph(
    storyId: string,
    branchId: string | null | 'any',
  ): Promise<{ entities: FalkorEntity[]; relationships: FalkorRel[] }> {
    let scopeEntity = `WHERE n.storyId='${escapeStr(storyId)}'`;
    if (branchId !== 'any') {
      const bind = branchId ? `'${escapeStr(branchId)}'` : 'null';
      scopeEntity += ` AND (n.branchId=${bind} OR n.branchId IS NULL)`;
    }
    const entResult = await this.run(
      `MATCH (n:Entity) ${scopeEntity} RETURN n.name, n.type, n.branchId`,
    );
    const entities = this.parseEntityRows(entResult);

    let scopeRel = `WHERE (a.storyId='${escapeStr(storyId)}' OR b.storyId='${escapeStr(storyId)}') AND (r.storyId='${escapeStr(storyId)}')`;
    if (branchId !== 'any') {
      const bind = branchId ? `'${escapeStr(branchId)}'` : 'null';
      scopeRel += ` AND (r.branchId=${bind} OR r.branchId IS NULL)`;
    }
    const relResult = await this.run(
      `MATCH (a:Entity)-[r:REL]->(b:Entity) ${scopeRel} RETURN a.name, a.type, r.type, b.name, b.type, r.summary, r.branchId`,
    );
    return { entities, relationships: this.parseRelRows(relResult) };
  }

  /** All episodes for a scope (used for greedy retrieval fallback). */
  async allEpisodes(storyId: string, branchId: string | null | 'any'): Promise<FalkorEpisode[]> {
    let scope = `WHERE ep.storyId='${escapeStr(storyId)}'`;
    if (branchId !== 'any') {
      const bind = branchId ? `'${escapeStr(branchId)}'` : 'null';
      scope += ` AND ep.branchId=${bind}`;
    }
    const result = await this.run(
      `MATCH (ep:Episode) ${scope} RETURN DISTINCT ep.id, ep.summary, ep.branchId`,
    );
    return this.parseEpisodeRows(result);
  }

  // ---- parsing (best-effort; returns [] on layout mismatch) ----
  private parseEntityRows(result: any[]): FalkorEntity[] {
    const out: FalkorEntity[] = [];
    const rows = this.rows(result);
    for (const r of rows) {
      const arr = this.asArr(r);
      if (!arr || arr.length < 3) continue;
      out.push({ name: String(arr[0]), type: String(arr[1]), branchId: arr[2] ? String(arr[2]) : null });
    }
    return out;
  }

  private parseRelRows(result: any[]): FalkorRel[] {
    const out: FalkorRel[] = [];
    const rows = this.rows(result);
    for (const r of rows) {
      const arr = this.asArr(r);
      if (!arr || arr.length < 7) continue;
      out.push({
        source: String(arr[0]),
        sourceType: String(arr[1]),
        type: String(arr[2]),
        target: String(arr[3]),
        targetType: String(arr[4]),
        summary: arr[5] ? String(arr[5]) : undefined,
        branchId: arr[6] ? String(arr[6]) : null,
      });
    }
    return out;
  }

  private parseEpisodeRows(result: any[]): FalkorEpisode[] {
    const out: FalkorEpisode[] = [];
    const rows = this.rows(result);
    for (const r of rows) {
      const arr = this.asArr(r);
      if (!arr || arr.length < 3) continue;
      out.push({ id: String(arr[0]), summary: String(arr[1]), branchId: arr[2] ? String(arr[2]) : null });
    }
    return out;
  }

  /** Flatten compact result to an array of row-arrays (tolerant of nesting). */
  private rows(result: any[]): any[][] {
    if (!Array.isArray(result)) return [];
    let guard = 0;
    return this.collectRows(result, guard);
  }

  private collectRows(node: any, depth: number): any[][] {
    if (depth > 4 || !Array.isArray(node)) return [];
    const out: any[][] = [];
    // Detect rows: arrays whose elements are themselves arrays of scalars.
    for (const item of node) {
      if (Array.isArray(item)) {
        if (item.length > 0 && typeof item[0] !== 'object') {
          out.push(item);
        } else {
          out.push(...this.collectRows(item, depth + 1));
        }
      }
    }
    return out;
  }

  private asArr(row: any): any[] | null {
    if (Array.isArray(row)) return row;
    if (row && typeof row === 'object') return Object.values(row);
    return null;
  }
}
