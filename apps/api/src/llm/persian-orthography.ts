/**
 * Persian Academy half-space (نیم‌فاصله, U+200C) for bound affixes.
 * LLMs emit نامها / میرود; this turns them into نام‌ها / می‌رود.
 * Only Persian runs are touched; Latin is left alone.
 */
const ZWNJ = '\u200c';
const PERSIAN_WORD = /[ءآ-ی\u200c]+/g;

const HA_EXCEPTIONS = new Set([
  'تنها',
  'تنهای',
  'تنهایی',
  'رها',
  'رهای',
  'رهایی',
  'بها',
  'بهای',
  'بهایی',
  'انتها',
  'انتهای',
  'انتهایی',
  'طاها',
]);

const TAR_EXCEPTIONS = new Set([
  'بهتر',
  'بهتری',
  'بهترین',
  'بیشتر',
  'بیشتری',
  'بیشترین',
  'کمتر',
  'کمتری',
  'کمترین',
  'دختر',
  'دختری',
  'چتر',
  'دفتر',
  'دکتر',
  'اختر',
  'استر',
  'متر',
  'لیتر',
  'تاتر',
  'تئاتر',
  'تآتر',
]);

/** Stems ending in silent ه where glued ای means ه‌ای (خانهای → خانه‌ای), not‌های. */
const SILENT_HEH = new Set([
  'خانه',
  'شده',
  'رفته',
  'آمده',
  'زنده',
  'مرده',
  'کرده',
  'گفته',
  'بوده',
  'دیده',
  'نشسته',
  'خوابیده',
  'ایستاده',
]);

/** Whole words starting with می that are not the imperfect prefix. */
const MI_NOUNS = [
  'میدان',
  'میزبان',
  'میخانه',
  'میراث',
  'میهمان',
  'میلیون',
  'میکروب',
  'میکرب',
  'میکده',
  'میعاد',
  'میانه',
  'میزان',
  'میمون',
  'میهن',
  'میان',
  'میوه',
  'میرزا',
  'میلاد',
  'میبد',
  'مینا',
  'مینو',
  'میز',
  'میل',
];

export const PERSIAN_ORTHOGRAPHY_RULE =
  'If writing in Persian, use نیم‌فاصله (U+200C) for bound affixes: نام‌ها not نامها; می‌رود not میرود; بزرگ‌تر not بزرگتر; خانه‌ای not خانهای.';

function isMiNounForm(bare: string): boolean {
  for (const noun of MI_NOUNS) {
    if (bare === noun) return true;
    if (bare.startsWith(noun) && /^(ها(?:یی|ی)?|تر(?:ین|ی)?)$/.test(bare.slice(noun.length))) {
      return true;
    }
  }
  return false;
}

function attachPrefixMi(word: string): string {
  if (word.startsWith(`نمی${ZWNJ}`) || word.startsWith(`می${ZWNJ}`)) return word;
  const bare = word.replaceAll(ZWNJ, '');
  if (isMiNounForm(bare)) return word;
  const m = word.match(/^(نمی|می)(.+)$/);
  if (!m || m[2].replaceAll(ZWNJ, '').length < 2) return word;
  return `${m[1]}${ZWNJ}${m[2]}`;
}

function attachSuffix(word: string, re: RegExp, exceptions: Set<string>): string {
  const bare = word.replaceAll(ZWNJ, '');
  if (exceptions.has(bare)) return word;
  const m = word.match(re);
  if (!m?.[1] || !m[2]) return word;
  if (m[1].endsWith(ZWNJ)) return word;
  if (m[1].replaceAll(ZWNJ, '').length < 1) return word;
  return `${m[1]}${ZWNJ}${m[2]}`;
}

function attachHehClitic(word: string): string {
  if (word.includes(ZWNJ)) return word;
  const m = word.match(/^(.*ه)(ام|ات|اش|اند|اید|ایم|مان|تان|شان)$/);
  if (!m?.[1] || !m[2]) return word;
  return `${m[1]}${ZWNJ}${m[2]}`;
}

function attachHehIndefinite(word: string): string {
  if (word.includes(ZWNJ)) return word;
  const bare = word.replaceAll(ZWNJ, '');
  const m = bare.match(/^(.*)(ای)$/);
  if (!m?.[1] || !SILENT_HEH.has(m[1])) return word;
  return `${m[1]}${ZWNJ}ای`;
}

function fixPersianWord(word: string): string {
  if (word.length < 3) return word;
  const bare = word.replaceAll(ZWNJ, '');
  if (HA_EXCEPTIONS.has(bare) || TAR_EXCEPTIONS.has(bare)) return word;

  let w = attachPrefixMi(word);
  w = attachHehIndefinite(w);
  w = attachSuffix(w, /^(.*?)(ها(?:یی|ی)?)$/, HA_EXCEPTIONS);
  w = attachSuffix(w, /^(.*?)(تر(?:ین|ی)?)$/, TAR_EXCEPTIONS);
  return attachHehClitic(w);
}

/** Insert ZWNJ for Persian affixes. Idempotent; a no-op on text with no Persian. */
export function fixPersianOrthography(text: string): string {
  if (!/[\u0600-\u06FF]/.test(text)) return text;

  let s = text
    .replace(/\u064a/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/\u00ad/g, ZWNJ);

  s = s.replace(/([ءآ-ی]) +(?=(?:ها(?:یی|ی)?|تر(?:ین|ی)?)(?![ءآ-ی]))/g, `$1${ZWNJ}`);
  s = s.replace(
    /([ءآ-ی]ه) +(?=(?:ای|ام|ات|اش|اند|اید|ایم|مان|تان|شان|ی)(?![ءآ-ی]))/g,
    `$1${ZWNJ}`,
  );
  s = s.replace(/(^|[^\u0600-\u06FF\u200c])(ن?می) +(?=[ءآ-ی])/gm, `$1$2${ZWNJ}`);

  return s.replace(PERSIAN_WORD, fixPersianWord).replace(/\u200c{2,}/g, ZWNJ);
}
