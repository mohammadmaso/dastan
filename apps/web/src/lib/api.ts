import type {
  Branch,
  Chapter,
  ContinueRequest,
  ContinuationOption,
  CreateStoryInput,
  LLMSettings,
  MemoryGraph,
  RetrievalStep,
  SaveLLMSettingsInput,
  Story,
  StoryNode,
  StoryPreferenceVersion,
  StorySummary,
} from '@storywriter/types';

const BASE = '/api';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body != null) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listStories: () => request<StorySummary[]>('/stories'),
  getStory: (id: string) => request<Story>(`/stories/${id}`),
  createStory: (input: CreateStoryInput) => request<Story>('/stories', { method: 'POST', body: JSON.stringify(input) }),
  updateStory: (id: string, patch: Partial<Story>) => request<Story>(`/stories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteStory: (id: string) => request<void>(`/stories/${id}`, { method: 'DELETE' }),
  duplicateStory: (id: string) => request<Story>(`/stories/${id}/duplicate`, { method: 'POST' }),

  getPreferences: (storyId: string) => request<StoryPreferenceVersion>(`/stories/${storyId}/preferences`),
  getPreferenceHistory: (storyId: string) =>
    request<StoryPreferenceVersion[]>(`/stories/${storyId}/preferences/history`),
  savePreferences: (storyId: string, preferences: unknown, note?: string) =>
    request<StoryPreferenceVersion>(`/stories/${storyId}/preferences`, {
      method: 'PUT',
      body: JSON.stringify({ preferences, note }),
    }),

  listBranches: (storyId: string) => request<Branch[]>(`/stories/${storyId}/branches`),
  getBranch: (id: string) => request<Branch>(`/branches/${id}`),
  createBranch: (storyId: string, body: { name?: string; parentBranchId?: string; forkNodeId?: string }) =>
    request<Branch>(`/stories/${storyId}/branches`, { method: 'POST', body: JSON.stringify(body) }),
  updateBranch: (id: string, patch: { name?: string; status?: string }) =>
    request<Branch>(`/branches/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteBranch: (id: string) => request<void>(`/branches/${id}`, { method: 'DELETE' }),
  duplicateBranch: (id: string) => request<Branch>(`/branches/${id}/duplicate`, { method: 'POST' }),
  exportBranch: (id: string) => `${BASE}/branches/${id}/export.md`,

  listNodes: (branchId: string) => request<StoryNode[]>(`/branches/${branchId}/nodes`),
  listStoryNodes: (storyId: string) => request<StoryNode[]>(`/stories/${storyId}/nodes`),
  getCurrentNode: (branchId: string) => request<StoryNode>(`/branches/${branchId}/nodes/current`),
  getNode: (id: string) => request<StoryNode>(`/nodes/${id}`),
  createNode: (body: {
    branchId: string;
    parentNodeId?: string | null;
    content: string;
    nodeType?: string;
    author?: string;
    continuationLabel?: string | null;
    makeCurrent?: boolean;
  }) => request<StoryNode>('/branches/' + body.branchId + '/nodes', { method: 'POST', body: JSON.stringify(body) }),
  updateNode: (id: string, patch: Record<string, unknown>) =>
    request<StoryNode>(`/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteNode: (id: string) => request<void>(`/nodes/${id}`, { method: 'DELETE' }),
  createChapter: (nodeId: string, title: string) =>
    request<Chapter>(`/nodes/${nodeId}/chapter`, { method: 'POST', body: JSON.stringify({ title }) }),

  getSettings: () => request<LLMSettings>('/settings'),
  saveSettings: (input: SaveLLMSettingsInput) =>
    request<LLMSettings>('/settings', { method: 'PUT', body: JSON.stringify(input) }),

  getGraph: (storyId: string, branchId: string | null) =>
    request<MemoryGraph>(`/stories/${storyId}/graph${branchId ? `?branchId=${branchId}` : '?branchId=all'}`),
  retrieveEntity: (storyId: string, name: string, branchId: string) =>
    request<unknown>(`/stories/${storyId}/entity/${encodeURIComponent(name)}?branchId=${branchId || 'all'}`),

  suggestions: (
    body: { storyId: string; branchId: string; nodeId?: string; count?: number; instruction?: string },
    signal?: AbortSignal,
  ) =>
    request<{ options: ContinuationOption[] }>('/ai/suggestions', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
};

export interface ContinueEvents {
  onDelta?: (text: string) => void;
  onRetrieval?: (step: RetrievalStep) => void;
  onActivity?: (message: string) => void;
  onNode?: (node: StoryNode) => void;
  onContinuations?: (options: ContinuationOption[]) => void;
  onError?: (error: string) => void;
}

/** Consume the AI SDK UI-message SSE stream from POST /ai/continue. */
export async function streamContinue(
  body: ContinueRequest,
  events: ContinueEvents,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/ai/continue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => null);
    throw new ApiError(err?.error ?? `Stream failed (${res.status})`, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame
        .split('\n')
        .find((l) => l.startsWith('data:'))
        ?.slice(5)
        .trim();
      if (!line || line === '[DONE]') continue;
      let chunk: { type?: string; delta?: string; data?: unknown };
      try {
        chunk = JSON.parse(line);
      } catch {
        continue;
      }
      const type = chunk.type ?? '';
      if (type === 'text-delta' && chunk.delta) events.onDelta?.(chunk.delta);
      else if (type === 'data-retrieval' && chunk.data) events.onRetrieval?.(chunk.data as RetrievalStep);
      else if (type === 'data-activity' && chunk.data) {
        const d = chunk.data as { message?: string };
        if (d.message) events.onActivity?.(d.message);
      } else if (type === 'data-node' && chunk.data) events.onNode?.(chunk.data as StoryNode);
      else if (type === 'data-continuations' && chunk.data) {
        events.onContinuations?.(chunk.data as ContinuationOption[]);
      } else if (type === 'data-error' && chunk.data) {
        const d = chunk.data as { error?: string };
        events.onError?.(d.error ?? 'Generation failed');
      } else if (type === 'error') {
        events.onError?.(String((chunk as { errorText?: string }).errorText ?? 'Generation failed'));
      }
    }
  }
}
