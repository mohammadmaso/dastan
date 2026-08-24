import assert from 'node:assert/strict';
import { parseContinuationOptions } from './continuation-options.js';

const wrapped = parseContinuationOptions(
  'Sure.\n```json\n{"options":[{"label":"The river crossing","summary":"They wade in."}]}\n```',
  3,
);
assert.equal(wrapped.length, 1);
assert.equal(wrapped[0].label, 'The river crossing');
assert.equal(parseContinuationOptions('not json', 3).length, 0);
assert.equal(parseContinuationOptions('{"options":[]}', 3).length, 0);
console.log('continuation-options ok');
