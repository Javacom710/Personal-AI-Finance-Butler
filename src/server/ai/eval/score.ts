import 'server-only';

/**
 * Deterministic comparison primitives shared by the golden suites
 * ([AI-SYSTEM.md §14](../../../../docs/AI-SYSTEM.md)).
 *
 * Each normalises **representation only** — never meaning. `"1250.00"` and
 * `"1250"` are the same amount; `"1250"` and `"1205"` are not, and nothing here
 * would ever make them so. A scorer that tolerated a near-miss figure would be
 * scoring the very error the suite exists to detect.
 */

/** Canonical form of a non-negative decimal string: no leading or trailing zeros. */
export function canonicalDecimal(value: string): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const whole = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

export function sameDecimal(actual: string, expected: string): boolean {
  const a = canonicalDecimal(actual);
  return a !== null && a === canonicalDecimal(expected);
}

/**
 * Canonical form of a free-text hint: lower case, punctuation as spaces, and a
 * leading "my" / "the" dropped. `"My HDFC Credit-Card"` → `"hdfc credit card"`.
 */
export function canonicalHint(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(?:my|the)\s+/, '');
}

/**
 * What a free-text field must be: `null` (must be absent), any one of a set of
 * accepted spellings, or `'unscored'` where the corpus deliberately makes no
 * claim. `'unscored'` is for judgment calls; it is never used to hide a field
 * that has a right answer.
 */
export type HintExpectation = null | readonly string[] | 'unscored';

export function hintMatches(actual: string | null, expected: HintExpectation): boolean {
  if (expected === 'unscored') return true;
  if (expected === null) return actual === null;
  if (actual === null) return false;
  const canonical = canonicalHint(actual);
  return expected.some((accepted) => canonicalHint(accepted) === canonical);
}
