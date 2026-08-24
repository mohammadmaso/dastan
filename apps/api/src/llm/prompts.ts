import type { StoryPreferences, StoryNode } from '@storywriter/types';
import type { RetrievedMemory } from '@storywriter/types';

/** Render preferences into a compact instruction block for the LLM. */
export function preferencesToPrompt(p: StoryPreferences): string {
  const lines: string[] = ['## Story Preferences'];

  const kv: Array<[string, unknown]> = [
    ['Genre', p.genre],
    ['Subgenre', p.subgenre],
    ['Premise', p.premise],
    ['Central conflict', p.centralConflict],
    ['Intended audience', p.intendedAudience],
    ['Story length', p.storyLength],
    ['Desired chapters', p.chapterCount],
    ['Perspective', p.perspective],
    ['POV type', p.povType],
    ['Tense', p.tense],
    ['Narrative voice', p.narrativeVoice],
    ['Language style', p.languageStyle],
    ['Dialogue density', p.dialogueDensity],
    ['Description density', p.descriptionDensity],
    ['Internal monologue', p.internalMonologue],
    ['Pacing', p.pacing],
    ['Scene length', p.sceneLength],
    ['Setting', p.setting],
    ['Time period', p.timePeriod],
    ['Geography', p.geography],
    ['Culture', p.culture],
    ['Politics', p.politics],
    ['Technology', p.technology],
    ['Magic system', p.magicSystem],
    ['Social rules', p.socialRules],
    ['Economic conditions', p.economicConditions],
    ['Important locations', p.importantLocations],
    ['Important organizations', p.importantOrganizations],
    ['Important objects', p.importantObjects],
    ['Historical events', p.historicalEvents],
    ['Storytelling', p.storytelling],
    ['Ending style', p.endingStyle],
    ['Sexual content boundaries', p.sexualContentBoundaries],
    ['Political/social themes', p.politicalThemes],
    ['Sensitive subjects', p.sensitiveSubjects],
  ];
  for (const [label, value] of kv) {
    if (value !== undefined && value !== null && value !== '') lines.push(`- ${label}: ${value}`);
  }

  if (p.tones?.length) lines.push(`- Tone(s): ${p.tones.join(', ')}`);
  if (p.customTone) lines.push(`- Custom tone: ${p.customTone}`);
  if (p.plotStructures?.length) lines.push(`- Plot structure(s): ${p.plotStructures.join(', ')}`);

  const level = (label: string, v: number | undefined) =>
    v !== undefined && v > 0 ? `- ${label} (1-5): ${v}` : null;
  for (const l of [
    level('Violence level', p.violenceLevel),
    level('Romance level', p.romanceLevel),
    level('Humor level', p.humorLevel),
    level('Horror level', p.horrorLevel),
  ]) {
    if (l) lines.push(l);
  }

  if (p.includeTopics?.length) lines.push(`- Must include: ${p.includeTopics.join(', ')}`);
  if (p.avoidTopics?.length) lines.push(`- Must avoid: ${p.avoidTopics.join(', ')}`);

  const adhere: Record<string, string> = {
    strict: 'Strictly follow my preferences.',
    mostly: 'Mostly follow my preferences, allowing tasteful deviation.',
    guideline: 'Treat preferences as guidelines.',
    surprise: 'Surprise me when appropriate, within the established world.',
  };
  lines.push(
    `- Instruction adherence: ${adhere[p.instructionAdherence] ?? 'Follow preferences'}`,
  );
  if (p.experimentalLevel !== undefined) {
    lines.push(`- Level of experimentation/creativity (1-5): ${p.experimentalLevel}`);
  }

  if (p.characters?.length) {
    lines.push('', 'Characters:');
    for (const c of p.characters) {
      const parts = [
        c.name && `name: ${c.name}`,
        c.role && `role: ${c.role}`,
        c.personality && `personality: ${c.personality}`,
        c.motivation && `motivation: ${c.motivation}`,
        c.goals && `goals: ${c.goals}`,
        c.fears && `fears: ${c.fears}`,
        c.relationships && `relationships: ${c.relationships}`,
        c.arc && `arc: ${c.arc}`,
        c.conflicts && `conflicts: ${c.conflicts}`,
        c.moralAlignment && `alignment: ${c.moralAlignment}`,
        c.secrets && `secrets: ${c.secrets}`,
        c.history && `history: ${c.history}`,
      ].filter(Boolean);
      lines.push(`- ${parts.join('; ')}`);
    }
  }

  return lines.join('\n');
}

/** Build the system instruction block for story generation. */
export function buildSystemPrompt(
  preferences: StoryPreferences,
  branchName: string,
  memoryContext: string,
  recentNodes: StoryNode[],
): string {
  const recent = recentNodes
    .map(
      (n, i) =>
        `\n--- Episode ${i + 1} (${n.continuationLabel ?? 'continuation'}) ---\n${n.content.trim()}`,
    )
    .join('\n');

  return [
    `You are an expert storytelling co-author collaborating with a human writer on the branch "${branchName}".`,
    '',
    'Your role is to write compelling, coherent narrative prose that continues the story. You work collaboratively: you must preserve continuity, respect established facts, develop characters, and offer meaningful alternatives. Never reset the story context. Do not summarize what has happened — write the actual next scene.',
    '',
    preferencesToPrompt(preferences),
    '',
    '## Relevant Retrieved Story Memory (facts already established)',
    memoryContext.trim() ? memoryContext.trim() : '(none retrieved)',
    '',
    '## Recent Events in This Branch (most recent last)',
    recent.trim() ? recent.trim() : '(story just starting)',
    '',
    '## Writing Instructions',
    '- Continue immediately from where the last episode ends; do not recap.',
    '- Write in flowing narrative prose appropriate to the preferences above.',
    '- End the segment at a natural, forward-looking moment.',
    '- Do not reference "the AI", "the system", or this prompt.',
    '',
    '## Persian orthography (when writing فارسی)',
    'Follow فرهنگستان conventions. Use نیم‌فاصله (U+200C) between a word and its bound affixes — never glue them and never use a full space.',
    '- plural ها: نام‌ها، کتاب‌ها (not نامها or نام ها)',
    '- prefix می / نمی: می‌رود، نمی‌داند (not میرود or می رود)',
    '- comparative تر / ترین: بزرگ‌تر، بزرگ‌ترین (not بزرگتر)',
    '- after silent ه: خانه‌ای، خانه‌ام، شده‌اند (not خانهای)',
  ].join('\n');
}

/** System instruction for the continuation-suggestions task. */
export const SUGGESTIONS_SYSTEM = `You are a story architect deeply familiar with this exact story. Using the narrative context provided (the story so far and the current end), propose several distinct continuations the writer could choose next.

Every option must:
- Name the concrete development: reference the specific characters, places, objects, conflicts or promises already established (use their real names).
- Open a genuinely different narrative direction — each option is a believable next beat for THIS story, not a generic plot beat.
- Preserve continuity: never contradict established facts, and build on what the characters were just doing.
- Be evocative and specific. Forbidden: vague labels like "A sudden complication", "The quiet aftermath", "An unexpected revelation", "A change of plans".
- When writing فارسی, follow فرهنگستان spelling: نیم‌فاصله (U+200C) for bound affixes — نام‌ها not نامها, می‌رود not میرود, بزرگ‌تر not بزرگتر, خانه‌ای not خانهای.

Return STRICT JSON in the following shape (no markdown, no prose outside JSON):
{
  "options": [
    { "label": "A short label naming the concrete development (2-6 words)", "summary": "One sentence, max 120 characters, describing what happens" },
    ... numberOfOptions items
  ]
}
Keep every summary under 120 characters so the full JSON fits in the response.`;

/** Build the prompt that asks the model to write one continuation segment. */
export function buildContinuationPrompt(params: {
  currentNode: string;
  instruction?: string;
  style?: string;
}): string {
  const lines = [
    'Write the next narrative segment of the story.',
  ];
  if (params.instruction?.trim()) {
    lines.push('', '## The writer\'s direction for this continuation', params.instruction.trim());
  }
  if (params.style?.trim()) {
    lines.push('', '## Desired style', params.style.trim());
  }
  lines.push('', 'Write the segment now (narrative prose only, no commentary).');
  return lines.join('\n');
}
