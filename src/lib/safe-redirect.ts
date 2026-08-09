/**
 * Open-redirect defence for any user-supplied "come back here afterwards" value.
 *
 * Kept as a pure module with no framework import so it can be unit-tested
 * directly — an open redirect on a login page is a phishing primitive, and this
 * is exactly the kind of function that deserves a table of adversarial inputs
 * rather than a glance.
 */

/**
 * Control characters and whitespace, checked by code point rather than by a
 * regular expression: a literal control character inside a character class is
 * invisible in a diff, and an escaped one attracts a lint suppression.
 */
function containsUnsafeCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    // Everything at or below U+0020 (space, tab, newline, NUL) and U+007F (DEL).
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Accept only a same-site absolute path. Returns `null` for anything else, so a
 * caller that forgets to check falls back to its default destination rather
 * than navigating somewhere attacker-chosen.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;

  // Must be an absolute path on this origin.
  if (!value.startsWith('/')) return null;

  // `//evil.com` and `/\evil.com` are protocol-relative URLs, not paths.
  if (value.startsWith('//')) return null;

  // A backslash anywhere is treated as a path separator by some parsers and not
  // by others; disagreement between this check and the browser is the bug.
  if (value.includes('\\')) return null;

  // A newline or tab lets a payload slip past a naive prefix check, and raw
  // whitespace is stripped by some parsers before the URL is resolved.
  if (containsUnsafeCharacter(value)) return null;

  // `/javascript:alert(1)` and other scheme-bearing paths.
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return null;

  return value;
}
