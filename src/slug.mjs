/** Pure helpers for turning branch names into safe path segments. */

/**
 * Mimics Herdr's native layout: invalid path characters and separators become
 * "-", repeats collapse, leading/trailing "-" and "." are trimmed.
 */
export function slugifyBranch(branch) {
  const slug = String(branch ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\/\\:*?"<>|\s\x00-\x1f]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!slug) throw new Error('Branch name produces an empty directory name');
  return slug;
}

/** Conservative subset of `git check-ref-format`, plus no leading "-" (flag injection). */
export function validateBranch(branch) {
  const b = String(branch ?? '').trim();
  const bad =
    !b ||
    b.startsWith('-') ||
    b.startsWith('/') ||
    b.endsWith('/') ||
    b.endsWith('.') ||
    b.endsWith('.lock') ||
    b === '@' ||
    b.includes('..') ||
    b.includes('@{') ||
    b.includes('//') ||
    // eslint-disable-next-line no-control-regex
    /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(b);
  if (bad) throw new Error(`Invalid branch name: ${JSON.stringify(String(branch ?? ''))}`);
  return b;
}
