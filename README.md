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
| Semantic memory  | FalkorDB knowledge graph + PostgreSQL episodic index    |
| LLM             | Any OpenAI-compatible endpoint (OpenAI, local models, …)|
| Infra            | Docker Compose, pnpm monorepo                            |

## Monorepo layout

```
apps/
  web/        Next.js frontend (dashboard, questionnaire, writing studio, graph)
  api/        Fastify backend (services, routes, memory, LLM)
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
# start postgres + falkordb:  docker compose up -d postgres falkordb
pnpm dev:api                # http://localhost:3001
pnpm dev:web                # http://localhost:3000
```

## Architecture

Two synchronized systems keep the app coherent:

- **Narrative state** (PostgreSQL) — the canonical structure: stories, branches,
  nodes, chapters, preferences (versioned), settings.
- **Semantic memory** (FalkorDB + PostgreSQL) — what the AI remembers: entities,
  relationships, and episodic content, scoped by `story_id` + `branch_id`.

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
  → Agentic Retrieval
       · plan search intents
       · scoped Graphiti-style searches (branch + story-wide)
       · entity/relationship expansion from FalkorDB
  → Build context
  → LLM streams the prose (SSE tokens shown live)
  → Save node → add episode to memory → propose continuations
```

The frontend shows **high-level retrieval activity** in real time (searching
memory, search intents, memory found, generating) — never hidden chain-of-thought.

### Branch isolation

Every memory operation is scoped by `story_id` and `branch_id`. Different
branches keep independent memories; story-wide facts (premise, characters, world
rules, preferences) remain shared across branches. Forked branches inherit their
lineage context for continuity.

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
- Docker Compose for the whole app (web, api, postgres, falkordb)

## Notes

- The memory layer implements the **Graphiti episodic/semantic memory pattern**
  (add-episode → extract entities/relationships → scoped retrieval) directly on
  top of **FalkorDB** plus a PostgreSQL episodic index, keeping the stack
  TypeScript-only. If FalkorDB or embeddings are unavailable, retrieval degrades
  gracefully to keyword/episode search — the app never loses user content.
- Single-user by design; the API is structured so auth/multi-user can be added
  later without a rewrite.
