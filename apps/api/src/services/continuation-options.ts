import type { ContinuationOption } from '@storywriter/types';

export function parseContinuationOptions(text: string, count: number): ContinuationOption[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      options?: Array<{ label?: string; summary?: string }>;
    };
    return (parsed.options ?? [])
      .filter((o) => o?.label)
      .slice(0, count)
      .map((o, i) => ({
        id: `sug-${i}-${Date.now()}`,
        label: String(o.label).slice(0, 80),
        summary: String(o.summary ?? ''),
      }));
  } catch {
    return [];
  }
}
