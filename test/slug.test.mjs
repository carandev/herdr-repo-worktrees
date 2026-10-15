import test from 'node:test';
import assert from 'node:assert/strict';
import { slugifyBranch, validateBranch } from '../src/slug.mjs';

test('slugifyBranch replaces slashes and collapses repeats', () => {
  assert.equal(slugifyBranch('feature/login'), 'feature-login');
  assert.equal(slugifyBranch('a//b\\\\c'), 'a-b-c');
});
test('slugifyBranch replaces invalid path chars and whitespace', () => {
  assert.equal(slugifyBranch('fix: a*b?"c"<d>|e f'), 'fix-a-b-c-d-e-f');
});
test('slugifyBranch trims dashes and dots', () => {
  assert.equal(slugifyBranch('..hidden.'), 'hidden');
  assert.equal(slugifyBranch('-/x/-'), 'x');
});
test('slugifyBranch keeps case', () => {
  assert.equal(slugifyBranch('Feat/ABC-1'), 'Feat-ABC-1');
});
test('slugifyBranch throws when nothing is left', () => {
  assert.throws(() => slugifyBranch('/..//'), /empty/i);
});
test('validateBranch accepts normal names', () => {
  assert.equal(validateBranch(' feat/x '), 'feat/x');
});
test('validateBranch rejects unsafe names', () => {
  for (const b of ['', '  ', '-rf', 'a b', 'a..b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', 'a\nb', 'x.lock', 'a/', '@{']) {
    assert.throws(() => validateBranch(b), /branch/i, JSON.stringify(b));
  }
});
