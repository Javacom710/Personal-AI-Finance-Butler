/**
 * Exact JSON for diagnostics — the presentation boundary for scaled decimals.
 *
 * **This is a formatter, not a converter.** Nothing here changes an internal
 * representation: `Money`, `UnitPrice`, `Quantity` and `Rate` remain `bigint` at
 * their declared scales ([ADR-04](../../../docs/DECISIONS.md#adr-04--money-is-an-exact-scaled-integer-never-a-float)),
 * and this module only decides how they are *written down* when a human or a log
 * needs to read them.
 *
 * ## Why it exists
 *
 * `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt` —
 * by specification, because JSON has no integer type that can hold one. Every
 * diagnostic that serialises a domain value therefore has to say what it wants,
 * and the two obvious answers are both wrong:
 *
 * - `Number(value)` loses precision above 2^53 and is exactly the float path
 *   ADR-04 exists to keep out of financial code. **Never.**
 * - `value.toString()` is lossless but prints raw scaled units — a price of
 *   ₹1,121 appears as `112100000000`, which is not a number any reader
 *   recognises and invites someone to compare it against a real price.
 *
 * So a scaled decimal is rendered at **its own scale**, exactly:
 * `{ units: 112100000000n }` → `"1121.00000000"`. Same digits the database
 * holds, same digits `pToDbString` produces, no float anywhere in the path.
 *
 * ## Distinguishing the four types structurally
 *
 * | Shape | Type | Scale |
 * |---|---|---|
 * | `{ minor, currency }` | `Money` | 4 |
 * | `{ units }` | `UnitPrice` **or** `Quantity` | 8 |
 * | `{ value }` | `Rate` | 10 |
 *
 * `UnitPrice` and `Quantity` are structurally identical, and that is harmless
 * here: `PRICE_SCALE` and `QTY_SCALE` are both 8, so the rendered digits are the
 * same either way. The ambiguity would matter if the scales ever diverged, which
 * is why the constants are read rather than written as literals — a change to
 * either one is a compile-time visit to this file.
 *
 * Any other `bigint` falls back to `toString()`: lossless, and honest about not
 * knowing what it is.
 */

import { formatFixed } from '../decimal/scaled';
import { MONEY_SCALE } from '../decimal/money';
import { PRICE_SCALE } from '../decimal/price';
import { QTY_SCALE } from '../decimal/quantity';
import { RATE_SCALE } from '../decimal/rate';

if (PRICE_SCALE !== QTY_SCALE) {
  // A module-load assertion rather than a comment, because the `{ units }`
  // branch below silently becomes ambiguous the moment these differ.
  throw new Error(
    `diagnostic-json: PRICE_SCALE (${PRICE_SCALE}) and QTY_SCALE (${QTY_SCALE}) have diverged; ` +
      'the { units } branch can no longer choose a scale unambiguously.',
  );
}

const UNIT_SCALE = PRICE_SCALE;

function isBigInt(value: unknown): value is bigint {
  return typeof value === 'bigint';
}

/**
 * A scaled decimal → its exact decimal string, or `null` if this is not one.
 *
 * Keys are checked with `in` and the field's type verified, so an unrelated
 * object that happens to have a `value` property is not mistaken for a `Rate`.
 */
export function formatScaledDecimal(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;

  if (isBigInt(record['minor']) && typeof record['currency'] === 'string') {
    // Money carries its currency separately; the diagnostic keeps them together
    // so a figure is never read against the wrong denomination.
    return `${formatFixed(record['minor'], MONEY_SCALE)} ${record['currency']}`;
  }
  if (isBigInt(record['units'])) return formatFixed(record['units'], UNIT_SCALE);
  if (isBigInt(record['value'])) return formatFixed(record['value'], RATE_SCALE);

  return null;
}

/**
 * A `JSON.stringify` replacer that renders scaled decimals exactly and never
 * throws on a `bigint`.
 *
 * Ordinary `JSON.stringify` semantics otherwise: a `Date` has already become an
 * ISO string via `toJSON` before a replacer sees it, so timestamps need no
 * special case.
 */
export function diagnosticReplacer(_key: string, value: unknown): unknown {
  const scaled = formatScaledDecimal(value);
  if (scaled !== null) return scaled;
  // Lossless, and not pretending to know the scale.
  if (isBigInt(value)) return value.toString();
  return value;
}

/**
 * Serialise anything for a diagnostic, exactly and without throwing.
 *
 * The intended readers are a smoke test, a log line and a bug report — never a
 * financial calculation. Nothing consumes this output as a number.
 */
export function toDiagnosticJson(value: unknown, space?: number): string {
  return JSON.stringify(value, diagnosticReplacer, space);
}
