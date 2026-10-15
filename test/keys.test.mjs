import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeKeys } from '../src/keys.mjs';

const names = (s) => decodeKeys(s).map((k) => k.name);

test('printable characters', () => {
  assert.deepEqual(decodeKeys('a'), [{ name: 'char', ch: 'a' }]);
  assert.deepEqual(decodeKeys('añ'), [{ name: 'char', ch: 'a' }, { name: 'char', ch: 'ñ' }]);
});
test('a lone ESC is escape', () => {
  assert.deepEqual(names('\x1b'), ['escape']);
});
test('CSI and SS3 arrows', () => {
  assert.deepEqual(names('\x1b[A\x1b[B\x1b[C\x1b[D'), ['up', 'down', 'right', 'left']);
  assert.deepEqual(names('\x1bOA\x1bOB\x1bOC\x1bOD'), ['up', 'down', 'right', 'left']);
});
test('home, end, delete, shift-tab', () => {
  assert.deepEqual(names('\x1b[H\x1b[F\x1bOH\x1bOF'), ['home', 'end', 'home', 'end']);
  assert.deepEqual(names('\x1b[1~\x1b[4~\x1b[7~\x1b[8~'), ['home', 'end', 'home', 'end']);
  assert.deepEqual(names('\x1b[3~'), ['delete']);
  assert.deepEqual(names('\x1b[Z'), ['shift-tab']);
});
test('enter, tab, backspace', () => {
  assert.deepEqual(names('\r'), ['enter']);
  assert.deepEqual(names('\n'), ['enter']);
  assert.deepEqual(names('\r\n'), ['enter']);
  assert.deepEqual(names('\t'), ['tab']);
  assert.deepEqual(names('\x7f\b'), ['backspace', 'backspace']);
});
test('control keys', () => {
  assert.deepEqual(names('\x01\x05\x15\x13\x03'), ['ctrl-a', 'ctrl-e', 'ctrl-u', 'ctrl-s', 'ctrl-c']);
});
test('several keys in one chunk and pasted text', () => {
  assert.deepEqual(decodeKeys('ab\x1b[Dc').map((k) => k.ch ?? k.name), ['a', 'b', 'left', 'c']);
  assert.equal(decodeKeys('feat/some-pasted-branch').length, 23);
});
test('a trailing ESC after other keys is still escape', () => {
  assert.deepEqual(names('\x1b[B\x1b'), ['down', 'escape']);
});
test('unknown sequences, alt-chars and truncated CSI are dropped', () => {
  assert.deepEqual(names('\x1b[99X'), []);
  assert.deepEqual(names('\x1bx'), []);
  assert.deepEqual(names('a\x1b['), ['char']);
  assert.deepEqual(names('\x00\x02'), []);
});
