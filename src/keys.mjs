/** Pure terminal key decoder for raw-mode stdin chunks. */

const CTRL = { '\x01': 'ctrl-a', '\x03': 'ctrl-c', '\x05': 'ctrl-e', '\x13': 'ctrl-s', '\x15': 'ctrl-u' };
const ARROWS = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', Z: 'shift-tab' };
const TILDE = { 1: 'home', 3: 'delete', 4: 'end', 7: 'home', 8: 'end' };

/**
 * Decodes one stdin chunk into key events: `{ name, ch? }`. `name` is `char` (with `ch`),
 * or one of enter, tab, shift-tab, backspace, delete, left, right, up, down, home, end,
 * escape, ctrl-a, ctrl-c, ctrl-e, ctrl-s, ctrl-u. Unknown sequences are dropped.
 * A chunk may hold several keys (fast typing, paste).
 */
export function decodeKeys(chunk) {
  const chars = Array.from(String(chunk));
  const keys = [];
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    if (c === '\x1b') {
      const next = chars[i + 1];
      if (next === undefined) {
        keys.push({ name: 'escape' });
      } else if (next === '[') {
        let j = i + 2;
        let params = '';
        while (j < chars.length && /[0-9;?]/.test(chars[j])) params += chars[j++];
        const final = chars[j];
        if (final === undefined) {
          i = j; // truncated sequence
          continue;
        }
        const name = final === '~' ? TILDE[params.split(';')[0]] : ARROWS[final];
        if (name) keys.push({ name });
        i = j;
      } else if (next === 'O') {
        const name = ARROWS[chars[i + 2]];
        if (name) keys.push({ name });
        i += 2;
      } else {
        i += 1; // Alt+key: ignored
      }
    } else if (c === '\r') {
      keys.push({ name: 'enter' });
      if (chars[i + 1] === '\n') i += 1;
    } else if (c === '\n') {
      keys.push({ name: 'enter' });
    } else if (c === '\t') {
      keys.push({ name: 'tab' });
    } else if (c === '\x7f' || c === '\b') {
      keys.push({ name: 'backspace' });
    } else if (CTRL[c]) {
      keys.push({ name: CTRL[c] });
    } else if (c >= ' ' && c !== '\x7f') {
      keys.push({ name: 'char', ch: c });
    }
  }
  return keys;
}
