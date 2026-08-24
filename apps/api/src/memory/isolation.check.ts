/**
 * Isolation invariant check.
 *
 * 1. Always: keepFact() never lets branch B facts into branch A's result set.
 * 2. When MEMORY_URL is reachable: seed facts into world + A + B groups in
 *    FalkorDB and assert Cypher reads don't cross namespaces.
 *
 * Run:  pnpm --filter @storywriter/api check:isolation
 *    or  npx tsx src/memory/isolation.check.ts
 */
import { branchGroup, keepFact, worldGroup, type MemoryFact } from './groups.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`isolation check failed: ${msg}`);
}

function filterCheck(): void {
  const storyId = '11111111-1111-1111-1111-111111111111';
  const branchA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const branchB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const world = worldGroup(storyId);
  const groupA = branchGroup(storyId, branchA);
  const groupB = branchGroup(storyId, branchB);

  const ctx = {
    worldGroup: world,
    branchGroup: groupA,
    ancestorGroups: [] as string[],
    allowedEpisodeUuids: new Set<string>(['ep-root']),
  };

  const worldFact: MemoryFact = { fact: 'The city is called Lumen', groupId: world, episodeUuids: ['ep-world'] };
  const aFact: MemoryFact = { fact: 'Mira has the brass key', groupId: groupA, episodeUuids: ['ep-a'] };
  const bFact: MemoryFact = { fact: 'Mira drowned', groupId: groupB, episodeUuids: ['ep-b'] };
  const ancestorOk: MemoryFact = {
    fact: 'They left the harbour',
    groupId: groupB,
    episodeUuids: ['ep-root'],
  };
  const ancestorLeak: MemoryFact = {
    fact: 'Post-fork secret of B',
    groupId: groupB,
    episodeUuids: ['ep-b-after-fork'],
  };

  assert(keepFact(worldFact, ctx), 'world facts must be visible to every branch');
  assert(keepFact(aFact, ctx), "a branch must see its own facts");
  assert(!keepFact(bFact, ctx), 'sibling branch B must never leak into A');

  const withAncestor = { ...ctx, ancestorGroups: [groupB] };
  assert(keepFact(ancestorOk, withAncestor), 'pre-fork ancestor facts on the allowed path must pass');
  assert(!keepFact(ancestorLeak, withAncestor), 'post-fork ancestor facts must be dropped');

  console.log('ok  keepFact filter (world + A, never B, ancestor path)');
}

async function liveCheck(): Promise<void> {
  const base = (process.env.MEMORY_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  let health: Response;
  try {
    health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.log('skip live Graphiti check (MEMORY_URL unreachable)');
    return;
  }
  if (!health.ok) {
    console.log('skip live Graphiti check (sidecar unhealthy)');
    return;
  }

  const storyId = `iso-${Date.now()}`;
  const world = worldGroup(storyId);
  const groupA = branchGroup(storyId, 'branch-a');
  const groupB = branchGroup(storyId, 'branch-b');

  const seed = (group_id: string, fact: string, source: string) =>
    fetch(`${base}/admin/seed-fact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id, fact, source, target: 'World', name: 'knows' }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`seed failed ${r.status}: ${await r.text()}`);
    });

  await seed(world, 'The city is called Lumen', 'City');
  await seed(groupA, 'Mira has the brass key', 'MiraA');
  await seed(groupB, 'Mira drowned', 'MiraB');

  const facts = async (group_id: string) => {
    const r = await fetch(`${base}/admin/facts-in-group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id }),
    });
    if (!r.ok) throw new Error(`facts-in-group failed ${r.status}`);
    const json = (await r.json()) as { facts: string[] };
    return json.facts;
  };

  const a = await facts(groupA);
  const b = await facts(groupB);
  const w = await facts(world);

  assert(w.some((f) => f.includes('Lumen')), 'world group should contain the city fact');
  assert(a.some((f) => f.includes('brass key')), 'branch A should contain its own fact');
  assert(b.some((f) => f.includes('drowned')), 'branch B should contain its own fact');
  assert(!a.some((f) => f.includes('drowned')), 'branch A must not contain branch B facts');
  assert(!b.some((f) => f.includes('brass key')), 'branch B must not contain branch A facts');
  assert(!w.some((f) => f.includes('drowned') || f.includes('brass key')), 'world must not contain branch facts');

  console.log('ok  live FalkorDB group_id namespaces');
}

filterCheck();
liveCheck()
  .then(() => {
    console.log('isolation check passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
