import type { Db } from '../db/index.js';
import type { AppConfig } from '../config.js';
import { MemoryService } from '../memory/memory-service.js';
import { StoryService } from './story-service.js';
import { BranchService } from './branch-service.js';
import { NodeService } from './node-service.js';
import { ChapterService } from './chapter-service.js';
import { PreferenceService } from './preference-service.js';
import { SettingsService } from './settings-service.js';
import { GenerationService } from './generation-service.js';
import { ExportService } from './export-service.js';

export interface Container {
  db: Db;
  stories: StoryService;
  branches: BranchService;
  nodes: NodeService;
  chapters: ChapterService;
  preferences: PreferenceService;
  settings: SettingsService;
  memory: MemoryService;
  generation: GenerationService;
  exporter: ExportService;
}

export function buildContainer(db: Db, config: AppConfig): Container {
  const chapters = new ChapterService(db);
  const settings = new SettingsService(db);
  const memory = new MemoryService(db, config, settings);
  const nodes = new NodeService(db, chapters, memory);
  const branches = new BranchService(db);
  const preferences = new PreferenceService(db, memory);
  const stories = new StoryService(db, branches, nodes, preferences, memory);
  const generation = new GenerationService(
    stories,
    branches,
    nodes,
    preferences,
    settings,
    memory,
  );
  const exporter = new ExportService(stories, branches, nodes);

  return {
    db,
    stories,
    branches,
    nodes,
    chapters,
    preferences,
    settings,
    memory,
    generation,
    exporter,
  };
}
