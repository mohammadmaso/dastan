# Storywriter

A production-quality, single-user **AI co-writing environment for branching,
persistent interactive stories**. The user shapes deep storytelling preferences,
the AI writes the story incrementally, every generated piece becomes part of the
story's persistent graph memory, the AI proposes multiple continuations, and
alternative branches stay alive forever. Any branch can be exported as a
standalone Markdown story.

```
         Root
           │
        Node 1
           │
    ┌──────┼──────┐
    │      │      │
 OptionA OptionB Custom
    │      │      │
 Node2A  Node2B  Node2C
    │
 Node3A
```

## Tech stack

| Layer            | Technology                                              |
| ---------------- | ------------------------------------------------------- |
| Frontend         | Next.js, TypeScript, Tailwind, shadcn/ui, React Flow    |
| Backend          | Fastify, TypeScript                                     |
| App state        | PostgreSQL                                              |
| Semantic memory  | Graphiti (`graphiti-core`) on FalkorDB, one `group_id` per branch |
| LLM             | Any OpenAI-compatible endpoint (OpenAI, local models, …)|
| Infra            | Docker Compose, pnpm monorepo                            |

## Monorepo layout

```
apps/
  web/        Next.js frontend (dashboard, questionnaire, writing studio, graph)
  api/        Fastify backend (services, routes, Graphiti client, LLM)
  memory/     Graphiti sidecar (FastAPI + graphiti-core on FalkorDB)
packages/
  types/      Shared domain types / typed API contracts
  config/     Shared TS config presets
infra/
  docker-compose.yml
  docker/
```

## Getting started

Prerequisites: Docker with Compose.

```bash
cp .env.example .env        # optional — defaults work out of the box
docker compose up --build
```

Then open:

- Web: http://localhost:3000
- API:  http://localhost:3001/health

Before generating, configure your LLM in **Settings** (gear icon in the header):
any OpenAI-compatible Base URL + API key + model. Local/self-hosted endpoints
(Ollama, vLLM, LM Studio, llama.cpp) work too.

### Running without Docker (development)

```bash
pnpm install
# start postgres + falkordb + memory:  docker compose up -d postgres falkordb memory
pnpm dev:api                # http://localhost:3001
pnpm dev:web                # http://localhost:3000
```

## Architecture

Two synchronized systems keep the app coherent:

- **Narrative state** (PostgreSQL) — the canonical structure: stories, branches,
  nodes, chapters, preferences (versioned), settings.
- **Semantic memory** (Graphiti on FalkorDB) — episodes, entities and facts,
  isolated by `group_id` (`story:{id}:world` and `story:{id}:branch:{id}`).

Services follow the spec:

```
StoryService · BranchService · NodeService · ChapterService
PreferenceService · GenerationService · RetrievalAgent · MemoryService · ExportService
```

### How a continuation is generated (streamed as server-sent events)

```
User chooses a direction
  → Story Preferences (latest version, changeable anytime)
  → Current branch + recent nodes (configurable count)
  → Agentic Retrieval (AI SDK tool loop)
       · search_memory / look_up_entity against Graphiti
       · group_id namespaces + post-filter at the fork point
  → Build context
  → LLM streams the prose (SSE tokens shown live)
  → Save node → add episode to memory → propose continuations
```

The frontend shows **high-level retrieval activity** in real time (searching
memory, search intents, memory found, generating) — never hidden chain-of-thought.

### Branch isolation

Every Graphiti write/search uses a `group_id`. Different branches never share a
namespace. Story-wide facts live in the world group. Forked branches search
ancestor groups and drop post-fork facts via the episode→node map.

### Editing nodes

Edits autosave (debounced) and reconcile memory: a node edit supersedes the old
episode and re-extracts entities, avoiding stale contradictions.

## Key environment variables (see `.env.example`)

```
POSTGRES_HOST / POSTGRES_PORT / POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD
FALKORDB_HOST / FALKORDB_PORT / FALKORDB_GRAPH
LLM_BASE_URL / LLM_API_KEY / LLM_MODEL          # defaults + provider
NEXT_PUBLIC_API_URL                             # browser → API (host address)
INTERNAL_API_URL                                # server-side proxy (docker service name)
```

## MVP feature coverage

- Create story + deep storytelling questionnaire (persistent, versioned)
- Story dashboard (rename / duplicate / delete / export / memory graph)
- Visual branching narrative tree (alternatives stay visible)
- Node editor with streaming generation, autosave, chapter boundaries
- Multiple continuation options + write-your-own + fork-a-branch
- Agentic scoped retrieval with a live activity panel
- Knowledge-graph viewer (entities, relationships, episodes, zoom/pan/search)
- Markdown export per branch
- Configurable LLM provider + generation settings
- Docker Compose for the whole app (web, api, memory, postgres, falkordb)

## Notes

- Memory is **real Graphiti** (`apps/memory`, `graphiti-core[falkordb]`). The
  Fastify API is a thin client. If the sidecar is down, writes skip memory and
  narrative state in Postgres is never lost.
- Single-user by design; the API is structured so auth/multi-user can be added
  later without a rewrite.
