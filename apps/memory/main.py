"""Graphiti memory sidecar.

Thin FastAPI wrapper around graphiti-core with a FalkorDB driver.
LLM / embedder credentials are passed per request (from the user's Settings
page) and cached by config hash so Fastify stays the single source of truth.
"""

from __future__ import annotations

import hashlib
import inspect
import logging
import os
import re
import traceback
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("memory")

app = FastAPI(title="storywriter-memory", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FALKOR_HOST = os.environ.get("FALKORDB_HOST", "localhost")
FALKOR_PORT = int(os.environ.get("FALKORDB_PORT", "6379"))
FALKOR_GRAPH = os.environ.get("FALKORDB_GRAPH", "storywriter")

# Graphiti 0.29+ rejects group_id characters other than [A-Za-z0-9_-].
_GROUP_UNSAFE = re.compile(r"[^A-Za-z0-9_-]+")


def _safe_gid(gid: str) -> str:
    return _GROUP_UNSAFE.sub("_", gid).strip("_")


# ---------------------------------------------------------------------------
# Graphiti client cache
# ---------------------------------------------------------------------------

_driver = None
_clients: dict[str, Any] = {}
_indices_built = False


def _get_driver():
    global _driver
    if _driver is None:
        from graphiti_core.driver.falkordb_driver import FalkorDriver

        kwargs: dict[str, Any] = {"host": FALKOR_HOST, "port": FALKOR_PORT}
        try:
            _driver = FalkorDriver(**kwargs, database=FALKOR_GRAPH)
        except TypeError:
            _driver = FalkorDriver(**kwargs)
    return _driver


class LLMOpts(BaseModel):
    base_url: str
    api_key: str = ""
    model: str
    embedding_model: str = "text-embedding-3-small"
    small_model: str | None = None


def _config_hash(llm: LLMOpts | None) -> str:
    if llm is None:
        return "default"
    raw = f"{llm.base_url}|{llm.model}|{llm.embedding_model}|{llm.api_key[:8]}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _graphiti(llm: LLMOpts | None):
    key = _config_hash(llm)
    if key in _clients:
        return _clients[key]

    from graphiti_core import Graphiti
    from graphiti_core.llm_client.config import LLMConfig
    from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient
    from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
    from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient

    # openai>=3 raises at client init if api_key is missing, so always pass one —
    # even the no-LLM path (delete / startup indices) cannot use Graphiti().
    opts = llm or LLMOpts(base_url="https://api.openai.com/v1", api_key="not-set", model="gpt-4o-mini")
    driver = _get_driver()
    cfg = LLMConfig(
        api_key=opts.api_key or "not-set",
        model=opts.model,
        small_model=opts.small_model or opts.model,
        base_url=opts.base_url.rstrip("/"),
    )
    llm_client = OpenAIGenericClient(config=cfg)
    embedder = OpenAIEmbedder(
        config=OpenAIEmbedderConfig(
            api_key=opts.api_key or "not-set",
            embedding_model=opts.embedding_model,
            base_url=opts.base_url.rstrip("/"),
        )
    )
    try:
        reranker = OpenAIRerankerClient(client=llm_client, config=cfg)
    except TypeError:
        reranker = OpenAIRerankerClient(config=cfg)

    client = Graphiti(
        graph_driver=driver,
        llm_client=llm_client,
        embedder=embedder,
        cross_encoder=reranker,
    )
    _clients[key] = client
    return client


async def _ensure_indices(g) -> None:
    global _indices_built
    if _indices_built:
        return
    try:
        await g.build_indices_and_constraints()
        _indices_built = True
        log.info("Graphiti indices ready")
    except Exception as err:
        log.warning("index build skipped: %s", err)


def _edge_dict(e: Any) -> dict[str, Any]:
    episodes = getattr(e, "episodes", None) or []
    return {
        "uuid": getattr(e, "uuid", None),
        "fact": getattr(e, "fact", "") or "",
        "name": getattr(e, "name", None),
        "source_node_uuid": getattr(e, "source_node_uuid", None),
        "target_node_uuid": getattr(e, "target_node_uuid", None),
        "group_id": getattr(e, "group_id", None),
        "episodes": list(episodes),
        "valid_at": str(getattr(e, "valid_at", "") or "") or None,
        "invalid_at": str(getattr(e, "invalid_at", "") or "") or None,
        "score": getattr(e, "score", None),
    }


def _node_dict(n: Any) -> dict[str, Any]:
    labels = getattr(n, "labels", None) or []
    attrs = getattr(n, "attributes", None) or {}
    return {
        "uuid": getattr(n, "uuid", None),
        "name": getattr(n, "name", "") or "",
        "summary": getattr(n, "summary", "") or "",
        "labels": list(labels),
        "group_id": getattr(n, "group_id", None) or attrs.get("group_id"),
        "attributes": attrs if isinstance(attrs, dict) else {},
    }


async def _search_edges(g, query: str, group_ids: list[str], center: str | None, limit: int):
    group_ids = [_safe_gid(g) for g in group_ids]
    kwargs: dict[str, Any] = {"query": query}
    # Graphiti APIs have drifted: try group_ids (list) then group_id (str).
    try:
        return await g.search(
            **kwargs,
            group_ids=group_ids,
            center_node_uuid=center,
            num_results=limit,
        )
    except TypeError:
        pass
    try:
        return await g.search(query, center, group_ids)
    except TypeError:
        pass
    results = []
    for gid in group_ids:
        try:
            chunk = await g.search(query, group_id=gid)
        except TypeError:
            chunk = await g.search(query)
            chunk = [e for e in chunk if getattr(e, "group_id", None) in group_ids]
        results.extend(chunk or [])
    return results


async def _search_nodes(g, query: str, group_ids: list[str], limit: int):
    from graphiti_core.search.search_config_recipes import NODE_HYBRID_SEARCH_RRF

    group_ids = [_safe_gid(g) for g in group_ids]
    config = NODE_HYBRID_SEARCH_RRF.model_copy(deep=True)
    config.limit = limit
    try:
        result = await g._search(query=query, config=config, group_ids=group_ids)
        return list(getattr(result, "nodes", []) or [])
    except TypeError:
        result = await g._search(query, config)
        nodes = list(getattr(result, "nodes", []) or [])
        return [n for n in nodes if getattr(n, "group_id", None) in group_ids or not group_ids]


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class AddEpisodeIn(BaseModel):
    name: str
    episode_body: str
    source_description: str = "story node"
    group_id: str
    reference_time: str | None = None
    llm: LLMOpts | None = None


class SearchIn(BaseModel):
    query: str
    group_ids: list[str] = Field(default_factory=list)
    center_node_uuid: str | None = None
    num_results: int = 10
    llm: LLMOpts | None = None


class NodeSearchIn(BaseModel):
    query: str
    group_ids: list[str] = Field(default_factory=list)
    num_results: int = 8
    llm: LLMOpts | None = None


class SeedFactIn(BaseModel):
    group_id: str
    fact: str
    source: str = "Alpha"
    target: str = "Beta"
    name: str = "relates_to"


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


@app.on_event("startup")
async def startup() -> None:
    try:
        g = _graphiti(None)
        await _ensure_indices(g)
    except Exception as err:
        log.warning("startup indices deferred: %s", err)


@app.get("/health")
async def health():
    try:
        driver = _get_driver()
        ok = True
        try:
            # Falkor / Neo4j drivers expose different ping helpers.
            if hasattr(driver, "client") and hasattr(driver.client, "ping"):
                pong = driver.client.ping()
                ok = pong is True or pong == "PONG" or pong == b"PONG"
        except Exception:
            ok = False
        return {"status": "ok" if ok else "degraded", "falkordb": ok, "indices": _indices_built}
    except Exception as err:
        return {"status": "degraded", "error": str(err)}


@app.post("/admin/build-indices")
async def build_indices(body: dict | None = None):
    llm = LLMOpts.model_validate(body["llm"]) if body and body.get("llm") else None
    g = _graphiti(llm)
    global _indices_built
    _indices_built = False
    await _ensure_indices(g)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Episodes
# ---------------------------------------------------------------------------


@app.post("/episodes")
async def add_episode(body: AddEpisodeIn):
    from graphiti_core.nodes import EpisodeType

    try:
        g = _graphiti(body.llm)
        await _ensure_indices(g)
        ref = (
            datetime.fromisoformat(body.reference_time.replace("Z", "+00:00"))
            if body.reference_time
            else datetime.now(timezone.utc)
        )
        result = await g.add_episode(
            name=body.name,
            episode_body=body.episode_body,
            source=EpisodeType.text,
            source_description=body.source_description,
            reference_time=ref,
            group_id=_safe_gid(body.group_id),
        )
    except Exception as err:
        log.error("add_episode failed: %s\n%s", err, traceback.format_exc())
        raise HTTPException(status_code=502, detail=f"Graphiti add_episode failed: {err}") from err

    episode = getattr(result, "episode", result)
    uuid = getattr(episode, "uuid", None) or getattr(result, "uuid", None)
    return {
        "uuid": uuid,
        "name": body.name,
        "group_id": _safe_gid(body.group_id),
    }


@app.delete("/episodes/{uuid}")
async def delete_episode(uuid: str, llm_base: str | None = None):
    try:
        g = _graphiti(None)
        if hasattr(g, "remove_episode"):
            await g.remove_episode(uuid)
        elif hasattr(g, "delete_episode"):
            await g.delete_episode(uuid)
        else:
            await _cypher_delete_episode(uuid)
    except Exception as err:
        log.warning("remove_episode %s: %s", uuid, err)
        try:
            await _cypher_delete_episode(uuid)
        except Exception as err2:
            raise HTTPException(status_code=502, detail=str(err2)) from err2
    return {"ok": True}


async def _cypher_delete_episode(uuid: str) -> None:
    # The episode lives in whichever group graph ingested it, and the caller only
    # has the uuid, so sweep every graph.
    q = f"MATCH (e:Episodic {{uuid: '{_esc(uuid)}'}}) DETACH DELETE e"
    client = _get_driver().client
    names = client.list_graphs()
    if inspect.isawaitable(names):
        names = await names
    for name in list(names or []) or [FALKOR_GRAPH]:
        try:
            await _run_cypher(q, str(name))
        except Exception as err:
            log.warning("delete episode %s in %s: %s", uuid, name, err)


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


@app.post("/search")
async def search(body: SearchIn):
    try:
        g = _graphiti(body.llm)
        edges = await _search_edges(
            g, body.query, body.group_ids, body.center_node_uuid, body.num_results
        )
    except Exception as err:
        log.error("search failed: %s\n%s", err, traceback.format_exc())
        raise HTTPException(status_code=502, detail=f"Graphiti search failed: {err}") from err
    return {"results": [_edge_dict(e) for e in (edges or [])]}


@app.post("/search/nodes")
async def search_nodes(body: NodeSearchIn):
    try:
        g = _graphiti(body.llm)
        nodes = await _search_nodes(g, body.query, body.group_ids, body.num_results)
    except Exception as err:
        log.error("node search failed: %s\n%s", err, traceback.format_exc())
        raise HTTPException(status_code=502, detail=f"Graphiti node search failed: {err}") from err
    return {"nodes": [_node_dict(n) for n in (nodes or [])]}


# ---------------------------------------------------------------------------
# Graph dump (for the visualiser)
# ---------------------------------------------------------------------------


NODE_Q = "MATCH (n:Entity) RETURN n.uuid, n.name, n.summary, n.group_id LIMIT 400"
REL_Q = (
    "MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity) "
    "RETURN a.uuid, a.name, b.uuid, b.name, r.name, r.fact, r.uuid, r.group_id LIMIT 800"
)


@app.get("/graph")
async def graph(group_ids: str = ""):
    # One FalkorDB graph per group_id, so scoping is the graph selection itself
    # rather than a group_id predicate.
    ids = [_safe_gid(g) for g in group_ids.split(",") if g] or [FALKOR_GRAPH]
    entities: list[dict[str, Any]] = []
    relationships: list[dict[str, Any]] = []

    for gid in ids:
        try:
            node_rows = await _run_cypher(NODE_Q, gid)
            rel_rows = await _run_cypher(REL_Q, gid)
        except Exception as err:
            log.warning("graph cypher failed for %s: %s", gid, err)
            continue
        for row in node_rows:
            vals = _row_vals(row)
            if len(vals) < 2:
                continue
            entities.append(
                {
                    "id": str(vals[0] or vals[1]),
                    "name": str(vals[1] or ""),
                    "summary": str(vals[2] or "") if len(vals) > 2 else "",
                    "group_id": str(vals[3]) if len(vals) > 3 and vals[3] else gid,
                    "type": "entity",
                }
            )
        for row in rel_rows:
            vals = _row_vals(row)
            if len(vals) < 6:
                continue
            relationships.append(
                {
                    "id": str(vals[6] or f"r:{gid}:{len(relationships)}"),
                    # Names stay for display; *_id are what the visualiser joins on.
                    "source": str(vals[1] or ""),
                    "target": str(vals[3] or ""),
                    "source_id": str(vals[0] or vals[1] or ""),
                    "target_id": str(vals[2] or vals[3] or ""),
                    "type": str(vals[4] or "relates_to"),
                    "summary": str(vals[5] or ""),
                    "group_id": str(vals[7]) if len(vals) > 7 and vals[7] else gid,
                }
            )

    return {"entities": entities, "relationships": relationships}


def _esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace("'", "\\'")


def _row_vals(row: Any) -> list[Any]:
    if isinstance(row, dict):
        return list(row.values())
    if isinstance(row, (list, tuple)):
        return list(row)
    return [row]


async def _run_cypher(query: str, graph_name: str | None = None) -> list[Any]:
    """Run raw Cypher against a single FalkorDB graph.

    Graphiti is multi-tenant on FalkorDB: every group_id becomes its own graph
    key, so direct Cypher has to select that graph. Going through
    driver.execute_query() would always hit the driver's default graph, which is
    empty for anything Graphiti wrote.
    """
    graph = _get_driver().client.select_graph(graph_name or FALKOR_GRAPH)
    result = graph.query(query)
    if inspect.isawaitable(result):
        result = await result
    if result is None:
        return []
    rows = getattr(result, "result_set", None)
    if rows is None:
        rows = getattr(result, "records", None)
    return list(rows or [])


# ---------------------------------------------------------------------------
# Isolation-check seed (no LLM): write a fact edge tagged with group_id.
# ---------------------------------------------------------------------------


@app.post("/admin/seed-fact")
async def seed_fact(body: SeedFactIn):
    uid = str(uuid4())
    gid = _safe_gid(body.group_id)
    q = (
        f"MERGE (a:Entity {{name: '{_esc(body.source)}', group_id: '{_esc(gid)}'}}) "
        f"MERGE (b:Entity {{name: '{_esc(body.target)}', group_id: '{_esc(gid)}'}}) "
        f"CREATE (a)-[r:RELATES_TO {{uuid: '{uid}', group_id: '{_esc(gid)}', "
        f"name: '{_esc(body.name)}', fact: '{_esc(body.fact)}'}}]->(b) "
        "RETURN r.uuid"
    )
    await _run_cypher(q, gid)
    return {"uuid": uid, "group_id": gid, "fact": body.fact}


@app.post("/admin/facts-in-group")
async def facts_in_group(body: dict):
    gid = _safe_gid(str(body.get("group_id") or ""))
    q = (
        f"MATCH ()-[r:RELATES_TO]->() WHERE r.group_id = '{_esc(gid)}' "
        "RETURN r.fact, r.group_id"
    )
    rows = await _run_cypher(q, gid)
    facts = []
    for row in rows:
        vals = _row_vals(row)
        if vals:
            facts.append(str(vals[0] or ""))
    return {"facts": facts}
