import assert from 'node:assert/strict';
import type { StoryPreferences } from '@storywriter/types';
import { buildSystemPrompt, SUGGESTIONS_SYSTEM } from './prompts.js';

const base = { tones: [], characters: [], plotStructures: [], includeTopics: [], avoidTopics: [] };
const prefs = (over: Partial<StoryPreferences> = {}) =>
  ({ ...base, ...over }) as unknown as StoryPreferences;

const system = (p: StoryPreferences) => buildSystemPrompt(p, 'main', '', []);

// Pacing scope rules are always present, and default to one beat per segment.
const dflt = system(prefs());
assert.match(dflt, /## Pacing and Scope/);
assert.match(dflt, /single beat/);
assert.match(dflt, /Dramatize instead of summarizing/);
assert.match(dflt, /at most one new complication/i);

// An explicit pacing preference must not be contradicted by the default beat budget.
assert.match(system(prefs({ pacing: 'slow' })), /single beat/);
assert.match(system(prefs({ pacing: 'moderate' })), /one beat, two at the very most/);
const fast = system(prefs({ pacing: 'fast' }));
assert.match(fast, /may cover several beats/);
assert.doesNotMatch(fast, /single beat/);

// Suggestions must ask for small, in-scene beats rather than a new direction per option.
assert.match(SUGGESTIONS_SYSTEM, /immediate next beat/);
assert.match(SUGGESTIONS_SYSTEM, /At most ONE option may open a new front/);
assert.doesNotMatch(SUGGESTIONS_SYSTEM, /genuinely different narrative direction/);

console.log('prompts ok');
