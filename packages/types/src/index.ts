// ============================================================================
// Shared domain types used across the API and the web app.
// Keep this package free of runtime dependencies — types only.
// ============================================================================

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------
export type StoryStatus = 'draft' | 'active' | 'archived';

export interface Story {
  id: string;
  title: string;
  description: string | null;
  genre: string | null;
  status: StoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StorySummary extends Story {
  nodeCount: number;
  branchCount: number;
  chapterCount: number;
}

export interface CreateStoryInput {
  title: string;
  description?: string | null;
  genre?: string | null;
  preferences?: StoryPreferenceInput | null;
}

export interface UpdateStoryInput {
  title?: string;
  description?: string | null;
  genre?: string | null;
  status?: StoryStatus;
}

// ---------------------------------------------------------------------------
// Story preferences
// ---------------------------------------------------------------------------
/**
 * The deep storytelling questionnaire results. Stored as JSON but strongly
 * typed here so both the questionnaire UI and the generation service share a
 * single contract.
 */
export interface CharacterDefinition {
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting' | 'other';
  personality?: string;
  motivation?: string;
  goals?: string;
  fears?: string;
  relationships?: string;
  arc?: string;
  conflicts?: string;
  moralAlignment?: string;
  secrets?: string;
  history?: string;
}

export interface StoryPreferences {
  // Story basics
  title?: string;
  genre?: string;
  subgenre?: string;
  premise?: string;
  centralConflict?: string;
  intendedAudience?: string;
  storyLength?: string;
  storyLengthKind?: 'short_story' | 'novella' | 'novel' | 'serialized' | string;
  chapterCount?: number;

  // Tone & atmosphere
  tones: string[];
  customTone?: string;

  // Narrative style
  perspective?: 'first' | 'second' | 'third';
  povType?: 'limited' | 'omniscient';
  tense?: 'present' | 'past';
  narrativeVoice?: string;
  languageStyle?: 'literary' | 'simple' | 'mixed';
  dialogueDensity?: 'low' | 'medium' | 'high';
  descriptionDensity?: 'low' | 'medium' | 'high';
  internalMonologue?: 'none' | 'light' | 'heavy';
  pacing?: 'slow' | 'moderate' | 'fast';
  sceneLength?: 'short' | 'medium' | 'long';

  // Characters & world
  characters: CharacterDefinition[];
  setting?: string;
  timePeriod?: string;
  geography?: string;
  culture?: string;
  politics?: string;
  technology?: string;
  magicSystem?: string;
  socialRules?: string;
  economicConditions?: string;
  importantLocations?: string;
  importantOrganizations?: string;
  importantObjects?: string;
  historicalEvents?: string;

  // Plot structure
  plotStructures: string[];
  storytelling?:
    | 'linear'
    | 'nonlinear'
    | 'multiple_timelines'
    | 'episodic'
    | 'character_driven'
    | 'plot_driven'
    | string;
  pacingPreference?: string;
  endingStyle?: 'open' | 'closed' | 'bittersweet';

  // Content preferences
  includeTopics: string[];
  avoidTopics: string[];
  violenceLevel: 0 | 1 | 2 | 3 | 4 | 5;
  romanceLevel: 0 | 1 | 2 | 3 | 4 | 5;
  humorLevel: 0 | 1 | 2 | 3 | 4 | 5;
  horrorLevel: 0 | 1 | 2 | 3 | 4 | 5;
  sexualContentBoundaries?: string;
  politicalThemes?: string;
  sensitiveSubjects?: string;

  // Writing preferences
  instructionAdherence: 'strict' | 'mostly' | 'guideline' | 'surprise';
  experimentalLevel: 0 | 1 | 2 | 3 | 4 | 5;
  maxExplicit?: string;
}

export interface StoryPreferenceInput {
  preferences: StoryPreferences;
  note?: string;
}

export interface StoryPreferenceVersion {
  id: string;
  storyId: string;
  preferences: StoryPreferences;
  note: string | null;
  version: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------
export type BranchStatus = 'active' | 'archived' | 'completed';

export interface Branch {
  id: string;
  storyId: string;
  parentBranchId: string | null;
  forkNodeId: string | null;
  name: string;
  status: BranchStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBranchInput {
  name?: string;
  parentBranchId?: string | null;
  forkNodeId?: string | null;
}

export interface UpdateBranchInput {
  name?: string;
  status?: BranchStatus;
}

// ---------------------------------------------------------------------------
// Story nodes
// ---------------------------------------------------------------------------
export type NodeType =
  | 'ROOT'
  | 'AI_GENERATED'
  | 'USER_WRITTEN'
  | 'CHOICE'
  | 'BRANCH'
  | 'CHAPTER_START'
  | 'CHAPTER_END';

export type NodeAuthor = 'ai' | 'user' | 'system';

/** Provenance of an AI generation for provenance / debugging. */
export interface GenerationMetadata {
  model?: string;
  temperature?: number;
  promptTokens?: number;
  completionTokens?: number;
  finishedReason?: string;
  createdAt?: string;
}

export interface StoryNode {
  id: string;
  storyId: string;
  branchId: string;
  parentNodeId: string | null;
  /** Index within the branch's linear order (for rendering + local context). */
  position: number;
  /** Order among siblings that share the same parent (keeps forks visible). */
  siblingIndex: number;
  content: string;
  nodeType: NodeType;
  author: NodeAuthor;
  /** The label of the continuation that led to this node (user-friendly). */
  continuationLabel: string | null;
  /** True when this node is the terminal node of its branch (the writing edge). */
  isCurrent: boolean;
  chapterId: string | null;
  chapterTitle: string | null;
  generationMetadata: GenerationMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNodeInput {
  branchId: string;
  parentNodeId?: string | null;
  content: string;
  nodeType?: NodeType;
  author?: NodeAuthor;
  continuationLabel?: string | null;
  makeCurrent?: boolean;
}

export interface UpdateNodeInput {
  content?: string;
  nodeType?: NodeType;
  continuationLabel?: string | null;
  isCurrent?: boolean;
  chapterId?: string | null;
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------
export interface Chapter {
  id: string;
  storyId: string;
  branchId: string;
  title: string;
  order: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Continuations / suggestions
// ---------------------------------------------------------------------------
export interface ContinuationOption {
  /** Stable id used to reselect/expand options. */
  id: string;
  label: string;
  summary: string;
}

export interface ContinuationResponse {
  options: ContinuationOption[];
}

// ---------------------------------------------------------------------------
// Memory / retrieval
// ---------------------------------------------------------------------------

export enum MemoryScope {
  GLOBAL = 'GLOBAL_STORY_MEMORY',
  BRANCH = 'CURRENT_BRANCH_MEMORY',
}

/** A high-level retrieval/tool activity event streamed to the UI (never CoT). */
export type ActivityEventType =
  | 'thinking'
  | 'searching_memory'
  | 'search_intent'
  | 'memory_found'
  | 'reviewing_recent'
  | 'building_context'
  | 'generation_started'
  | 'generation_token'
  | 'generation_finished'
  | 'node_saved'
  | 'error';

export interface ActivityEvent {
  type: ActivityEventType;
  message?: string;
  query?: string;
  scope?: MemoryScope;
  token?: string;
  facts?: string[];
  at: string;
}

/** Live retrieval step shown in the agent-trace rail. */
export interface RetrievalStep {
  id: string;
  tool: 'search_memory' | 'look_up_entity';
  query: string;
  scope?: MemoryScope | string;
  status: 'searching' | 'found' | 'empty' | 'error';
  facts?: string[];
  at: string;
}

export interface MemoryEntity {
  id: string;
  name: string;
  type: string;
  summary?: string;
}

export interface MemoryRelationship {
  id: string;
  source: string;
  target: string;
  type: string;
  summary?: string;
}

export interface MemoryGraph {
  storyId: string;
  branchId: string | null;
  entities: MemoryEntity[];
  relationships: MemoryRelationship[];
}

/** A memory detail panel payload. */
export interface MemoryEntityDetail {
  entity: MemoryEntity | null;
  relationships: MemoryRelationship[];
  episodes: Array<{ id: string; summary: string; branchId: string | null; at: string }>;
}

// ---------------------------------------------------------------------------
// LLM / settings
// ---------------------------------------------------------------------------
export interface GenerationSettings {
  temperature: number;
  maxTokens: number;
  topP: number;
  suggestionCount: number;
  retrievalDepth: number;
  recentNodeCount: number;
}

export interface LLMSettings {
  provider: 'openai' | 'anthropic' | 'openai_compatible';
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  /** Graphiti-style embedding model used to embed story memory. */
  embeddingModel: string;
  /** Whether remote embeddings are enabled (falls back to local hashed vectors). */
  embeddingEnabled: boolean;
  generation: GenerationSettings;
}

export interface SaveLLMSettingsInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
  provider?: LLMSettings['provider'];
  embeddingModel?: string;
  embeddingEnabled?: boolean;
  generation: GenerationSettings;
}

// ---------------------------------------------------------------------------
// Generation requests / responses
// ---------------------------------------------------------------------------
export interface ContinueRequest {
  storyId: string;
  branchId: string;
  /** Node to continue from; omit to continue from the branch's current node. */
  nodeId?: string;
  /** When writing into a fresh companion branch, the lineage branch for context. */
  parentBranchId?: string;
  instruction?: string;
  style?: string;
  temperature?: number;
  maxTokens?: number;
  suggestionCount?: number;
}

export interface ContinueStreamChunk {
  kind:
    | 'activity'
    | 'node'
    | 'continuations'
    | 'done'
    | 'error';
  activity?: ActivityEvent;
  node?: StoryNode;
  continuations?: ContinuationOption[];
  error?: string;
  at?: string;
}

export interface RetrieveRequest {
  storyId: string;
  branchId: string;
  query: string;
  scope?: MemoryScope[];
  depth?: number;
}

export interface RetrievedMemory {
  text: string;
  score: number;
  scope: MemoryScope;
}
