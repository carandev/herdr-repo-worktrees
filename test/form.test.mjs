import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { decodeKeys } from '../src/keys.mjs';
import { createForm, defaultPath, parseRefs, rankRefs, render, setStatus, suggestionsFor, update } from '../src/form.mjs';

const REFS = parseRefs([
  'refs/heads/main', 'refs/heads/feat/a', 'refs/heads/release/2026',
  'refs/remotes/origin/HEAD', 'refs/remotes/origin', 'refs/remotes/origin/main', 'refs/remotes/origin/dev',
].join('\n'));

const base = (over = {}) => createForm({ repoName: 'repo', repoRoot: '/repo', directory: '.claude/worktrees', refs: REFS, pathApi: path.posix, ...over });
/** Feeds raw terminal input; returns the final state and every effect emitted. */
function type(state, input) {
  const effects = [];
  for (const key of decodeKeys(input)) {
    const r = update(state, key);
    state = r.state;
    if (r.effect) effects.push(r.effect);
  }
  return { state, effects };
}
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const boxLines = (text) => text.split('\r\n').filter((l) => /^[╭│╰]/.test(l));

test('parseRefs drops symbolic HEAD and bare remote names', () => {
  assert.deepEqual(REFS.map((r) => r.name), ['main', 'feat/a', 'release/2026', 'origin/main', 'origin/dev']);
  assert.deepEqual(REFS.map((r) => r.local), [true, true, true, false, false]);
});
test('rankRefs: empty query lists locals first, case-insensitive, max 5', () => {
  assert.deepEqual(rankRefs(REFS, ''), ['main', 'feat/a', 'release/2026', 'origin/main', 'origin/dev']);
  assert.deepEqual(rankRefs(REFS, 'MA'), ['main', 'origin/main']);
  assert.deepEqual(rankRefs(REFS, 'rel'), ['release/2026']);
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `b${i}`, local: true }));
  assert.equal(rankRefs(many, '').length, 5);
});
test('rankRefs puts prefix matches before substring matches', () => {
  const refs = [{ name: 'x-main', local: true }, { name: 'main-2', local: true }];
  assert.deepEqual(rankRefs(refs, 'main'), ['main-2', 'x-main']);
});

test('typing and editing', () => {
  let { state } = type(base(), 'feat/x');
  assert.equal(state.values.branch, 'feat/x');
  assert.equal(state.cursors.branch, 6);
  ({ state } = type(state, '\x7f'));
  assert.equal(state.values.branch, 'feat/');
  ({ state } = type(state, '\x1b[3~'));
  assert.equal(state.values.branch, 'feat/');
  ({ state } = type(state, '\x1b[H\x1b[3~'));
  assert.equal(state.values.branch, 'eat/');
  assert.equal(state.cursors.branch, 0);
  ({ state } = type(state, '\x1b[F'));
  assert.equal(state.cursors.branch, 4);
  ({ state } = type(state, '\x01Z\x05!'));
  assert.equal(state.values.branch, 'Zeat/!');
  ({ state } = type(state, '\x15'));
  assert.deepEqual([state.values.branch, state.cursors.branch], ['', 0]);
});
test('cursor does not move past the ends', () => {
  let { state } = type(base(), 'ab\x1b[C\x1b[C\x1b[D\x1b[D\x1b[D');
  assert.equal(state.cursors.branch, 0);
  ({ state } = type(state, '\x7f'));
  assert.equal(state.values.branch, 'ab');
});

test('field navigation', () => {
  let { state } = type(base(), '\t');
  assert.equal(state.focus, 1);
  ({ state } = type(state, '\t'));
  assert.equal(state.focus, 2);
  ({ state } = type(state, '\x1b[B'));
  assert.equal(state.focus, 2);
  ({ state } = type(state, '\t'));
  assert.equal(state.focus, 0);
  ({ state } = type(state, '\x1b[Z'));
  assert.equal(state.focus, 2);
  ({ state } = type(state, '\x1b[A'));
  assert.equal(state.focus, 1);
});
test('Enter moves next on Branch and Base, and submits on Path', () => {
  let { state, effects } = type(base(), 'feat/x\r');
  assert.equal(state.focus, 1);
  assert.deepEqual(effects, []);
  ({ state, effects } = type(state, '\r\r'));
  assert.equal(state.focus, 2);
  assert.deepEqual(effects, ['submit']);
});
test('Ctrl+S submits from anywhere when valid', () => {
  assert.deepEqual(type(base(), 'feat/x\t\x13').effects, ['submit']);
});
test('submit with an invalid or empty branch stays in the form with an error', () => {
  let r = type(base(), '\x13');
  assert.deepEqual(r.effects, []);
  assert.match(r.state.status, /branch/i);
  assert.equal(r.state.focus, 0);
  r = type(base(), 'bad..name\t\t\r');
  assert.deepEqual(r.effects, []);
  assert.match(r.state.status, /invalid branch/i);
  assert.equal(r.state.focus, 0);
  r = type(base(), 'ok\t-bad\x13');
  assert.deepEqual(r.effects, []);
  assert.equal(r.state.focus, 1);
  assert.match(r.state.status, /base ref/i);
});
test('editing clears the status; setStatus keeps the form', () => {
  let state = setStatus(base(), 'boom');
  assert.equal(state.status, 'boom');
  ({ state } = type(state, 'a'));
  assert.equal(state.status, '');
});
test('Esc and Ctrl+C cancel', () => {
  assert.deepEqual(type(base(), '\x1b').effects, ['cancel']);
  assert.deepEqual(type(base(), '\x03').effects, ['cancel']);
});

test('defaultPath follows the branch live and is null when invalid', () => {
  assert.equal(defaultPath(base()), null);
  assert.equal(defaultPath(type(base(), 'feat/x').state), '/repo/.claude/worktrees/feat-x');
  assert.equal(defaultPath(type(base(), 'a..b').state), null);
});

const onBase = (text = '') => type(base(), `\t${text}`).state;
test('suggestions only show while Base is focused', () => {
  assert.deepEqual(suggestionsFor(base()), []);
  assert.deepEqual(suggestionsFor(onBase('ma')), ['main', 'origin/main']);
});
test('Down highlights, Up from the first clears, Enter accepts the highlight', () => {
  let { state } = type(onBase('ma'), '\x1b[B');
  assert.equal(state.highlight, 0);
  ({ state } = type(state, '\x1b[B'));
  assert.equal(state.highlight, 1);
  ({ state } = type(state, '\x1b[B'));
  assert.equal(state.highlight, 1);
  ({ state } = type(state, '\x1b[A\x1b[A'));
  assert.equal(state.highlight, -1);
  assert.equal(state.focus, 1);
  ({ state } = type(state, '\x1b[B\x1b[B\r'));
  assert.equal(state.values.base, 'origin/main');
  assert.equal(state.focus, 1);
  assert.equal(state.highlight, -1);
});
test('Enter without a highlight moves to the next field', () => {
  const { state } = type(onBase('ma'), '\r');
  assert.equal(state.focus, 2);
  assert.equal(state.values.base, 'ma');
});
test('Tab and Right (at end) accept the first suggestion', () => {
  const { state } = type(onBase('re'), '\t');
  assert.deepEqual([state.values.base, state.focus], ['release/2026', 1]);
  assert.equal(state.cursors.base, 12);
  assert.equal(type(onBase('re'), '\x1b[C').state.values.base, 'release/2026');
});
test('with empty text, Tab moves on instead of accepting an unhighlighted suggestion', () => {
  const { state } = type(onBase(), '\t');
  assert.equal(state.focus, 2);
  assert.equal(state.values.base, '');
});
test('Right in the middle of the text only moves the cursor', () => {
  const { state } = type(onBase('re'), '\x1b[D');
  assert.equal(state.cursors.base, 1);
  assert.equal(type(state, '\x1b[C').state.values.base, 're');
});
test('Tab moves on once the text already equals the suggestion', () => {
  assert.equal(type(onBase('release/2026'), '\t').state.focus, 2);
});
test('Esc clears a highlight first, then cancels', () => {
  let r = type(onBase('ma'), '\x1b[B\x1b');
  assert.equal(r.state.highlight, -1);
  assert.deepEqual(r.effects, []);
  r = type(r.state, '\x1b');
  assert.deepEqual(r.effects, ['cancel']);
});
test('arrows move fields when there is no suggestion list', () => {
  assert.equal(type(onBase('zzz'), '\x1b[B').state.focus, 2);
  assert.equal(type(onBase('zzz'), '\x1b[A').state.focus, 0);
});
test('typing resets the highlight', () => {
  assert.equal(type(onBase('ma'), '\x1b[Bi').state.highlight, -1);
});

test('render: key lines, no color codes with color:false', () => {
  const state = type(base({ layout: [{}, { split: 'right', from: 0 }, { label: 't' }], layoutKey: '*' }), 'feat/vouchers').state;
  const { text, cursor } = render(state, { columns: 60, color: false });
  assert.ok(!/\x1b\[[0-9;]*m/.test(text));
  const lines = text.split('\r\n');
  assert.match(lines[0], /^╭─ New worktree · repo ─+╮$/);
  assert.match(lines[1], /^│ Branch {5}feat\/vouchers +│$/);
  assert.match(lines[2], /^│ Base ref {3}\s+│$/);
  assert.match(lines[3], /^│ Path {7}\.claude\/worktrees\/feat-vouchers +│$/);
  assert.ok(lines.some((l) => /→ \/repo\/\.claude\/worktrees\/feat-vouchers/.test(l)));
  assert.ok(lines.some((l) => /Layout: \* · 2 tabs, 3 panes/.test(l)));
  assert.ok(lines.some((l) => /Enter next\/create/.test(l)));
  assert.deepEqual(cursor, { row: 2, col: 14 + 13 });
  for (const l of boxLines(text)) assert.equal([...l].length, 59);
});
test('render: Layout none, suggestions, color codes, status', () => {
  let state = setStatus(onBase('ma'), 'create failed');
  const colored = render(state, { columns: 60, color: true });
  assert.ok(/\x1b\[[0-9;]*m/.test(colored.text));
  const lines = strip(colored.text).split('\r\n');
  assert.ok(lines.some((l) => /Layout: none/.test(l)));
  assert.ok(lines.some((l) => /create failed/.test(l)));
  assert.ok(lines.some((l) => /main {2}origin\/main/.test(l)));
  assert.equal(colored.cursor.row, 3);
  state = type(state, '\x1b[B').state;
  assert.ok(render(state, { columns: 60, color: false }).text.includes('▸ main'));
});
test('render: invalid branch shows an inline error', () => {
  const { text } = render(type(base(), 'a..b').state, { columns: 70, color: false });
  assert.match(text.split('\r\n')[1], /✗ Invalid branch/);
});
test('render: placeholder only for a valid branch; empty Path cursor sits at the value start', () => {
  assert.ok(!render(base(), { columns: 60, color: false }).text.includes('.claude/worktrees'));
  const { cursor } = render(type(base(), 'b\t\t').state, { columns: 60, color: false });
  assert.deepEqual(cursor, { row: 4, col: 14 });
});
test('render: long values are truncated with an ellipsis, never wrapped', () => {
  const long = 'x'.repeat(80);
  const { text, cursor } = render(type(base(), long).state, { columns: 40, color: false });
  assert.ok(text.split('\r\n')[1].includes('…'));
  for (const l of boxLines(text)) assert.equal([...l].length, 39);
  assert.ok(cursor.col <= 38);
  const tail = render(type(base(), long + '\x1b[H').state, { columns: 40, color: false });
  assert.ok(tail.text.split('\r\n')[1].includes('…'));
  assert.equal(tail.cursor.col, 14);
});
