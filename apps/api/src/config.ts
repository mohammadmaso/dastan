// Central environment configuration. All secrets come from the environment and
// are never logged or exposed to the client.

export interface AppConfig {
  port: number;
  host: string;

  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };

  falkordb: {
    host: string;
    port: number;
    graph: string;
  };

  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    embeddingModel: string;
  };
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: int(env.PORT, 3001),
    host: env.HOST ?? '0.0.0.0',
    postgres: {
      host: env.POSTGRES_HOST ?? 'localhost',
      port: int(env.POSTGRES_PORT, 5432),
      database: env.POSTGRES_DB ?? 'storywriter',
      user: env.POSTGRES_USER ?? 'storywriter',
      password: env.POSTGRES_PASSWORD ?? 'storywriter',
    },
    falkordb: {
      host: env.FALKORDB_HOST ?? 'localhost',
      port: int(env.FALKORDB_PORT, 6379),
      graph: env.FALKORDB_GRAPH ?? 'storywriter',
    },
    llm: {
      baseUrl: (env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
      apiKey: env.LLM_API_KEY ?? '',
      model: env.LLM_MODEL ?? 'gpt-4o-mini',
      embeddingModel: env.MEMORY_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    },
  };
}
