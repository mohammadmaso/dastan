import type { ContinuationOption } from '@storywriter/types';

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : trimmed;
}

function unescapeJsonString(raw: string): string {
  return raw.replace(/\\(["\\nrt/])/g, (_, ch: string) => {
    if (ch === 'n') return '\n';
    if (ch === 'r') return '\r';
    if (ch === 't') return '\t';
    return ch;
  });
}

function mapOptions(
  raw: Array<{ label?: string; summary?: string }>,
  count: number,
): ContinuationOption[] {
  return raw
    .filter((o) => o?.label)
    .slice(0, count)
    .map((o, i) => ({
      id: `sug-${i}-${Date.now()}`,
      label: String(o.label).slice(0, 80),
      summary: String(o.summary ?? ''),
    }));
}

function tryParseJsonObject(text: string, count: number): ContinuationOption[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      options?: Array<{ label?: string; summary?: string }>;
    };
    return mapOptions(parsed.options ?? [], count);
  } catch {
    return [];
  }
}

/** Salvage complete option objects when the model truncates mid-JSON (finish_reason=length). */
function salvageOptions(text: string, count: number): ContinuationOption[] {
  const options: ContinuationOption[] = [];
  const patterns = [
    /\{\s*"label"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"summary"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/g,
    /\{\s*"summary"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"label"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null && options.length < count) {
      const label = unescapeJsonString(re === patterns[0] ? m[1] : m[2]);
      const summary = unescapeJsonString(re === patterns[0] ? m[2] : m[1]);
      if (!label.trim()) continue;
      options.push({
        id: `sug-${options.length}-${Date.now()}`,
        label: label.slice(0, 80),
        summary,
      });
    }
    if (options.length) break;
  }
  return options;
}

export function parseContinuationOptions(text: string, count: number): ContinuationOption[] {
  const cleaned = stripMarkdownFence(text);
  const fromJson = tryParseJsonObject(cleaned, count);
  if (fromJson.length) return fromJson;
  return salvageOptions(cleaned, count);
}
