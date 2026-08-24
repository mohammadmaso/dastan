/**
 * Run: pnpm --filter @storywriter/api check:persian
 *   or: npx tsx src/llm/persian-orthography.check.ts
 */
import { fixPersianOrthography } from './persian-orthography.js';

const ZWNJ = '\u200c';

function assertEq(got: string, expected: string, label: string): void {
  if (got !== expected) {
    throw new Error(
      `${label}\n  got:      ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`,
    );
  }
}

const cases: Array<[string, string]> = [
  ['نامها', `نام${ZWNJ}ها`],
  ['نام ها', `نام${ZWNJ}ها`],
  [`نام${ZWNJ}ها`, `نام${ZWNJ}ها`],
  ['کتابهای', `کتاب${ZWNJ}های`],
  ['خانهای', `خانه${ZWNJ}ای`],
  ['آنها', `آن${ZWNJ}ها`],
  ['تنها', 'تنها'],
  ['تنهایی', 'تنهایی'],
  ['رها', 'رها'],
  ['میرود', `می${ZWNJ}رود`],
  ['می رود', `می${ZWNJ}رود`],
  [`می${ZWNJ}رود`, `می${ZWNJ}رود`],
  ['نمیداند', `نمی${ZWNJ}داند`],
  ['میدان', 'میدان'],
  ['میدانها', `میدان${ZWNJ}ها`],
  ['میز', 'میز'],
  ['بزرگتر', `بزرگ${ZWNJ}تر`],
  ['بزرگترین', `بزرگ${ZWNJ}ترین`],
  ['بهتر', 'بهتر'],
  ['بهترین', 'بهترین'],
  ['دختر', 'دختر'],
  ['خانهای', `خانه${ZWNJ}ای`],
  ['خانه ای', `خانه${ZWNJ}ای`],
  ['شدهاند', `شده${ZWNJ}اند`],
  ['Hello نامها world', `Hello نام${ZWNJ}ها world`],
];

for (const [input, expected] of cases) {
  assertEq(fixPersianOrthography(input), expected, input);
}

assertEq(fixPersianOrthography('Once upon a time'), 'Once upon a time', 'latin passthrough');

console.log('persian orthography check passed');
