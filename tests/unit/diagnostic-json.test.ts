/**
 * The diagnostic serialization boundary.
 *
 * A regression for a real defect: the live smoke test ended with
 * `TypeError: Do not know how to serialize a BigInt`. Every reported figure had
 * already printed correctly — those go through `pToDbString` — but the final
 * **secret-leak check** called plain `JSON.stringify` on a `PriceObservation`,
 * whose `close` is a `UnitPrice` holding a `bigint`. So the one check that
 * existed to keep the API key out of the output was the thing that crashed, and
 * because it ran last it never ran at all.
 *
 * Two properties are asserted throughout, and they are the whole point:
 *
 * 1. **It never throws** on any normalized market-data result.
 * 2. **It never loses a digit.** Rendering is exact at the type's own scale, and
 *    no value passes through `Number()` — which is the float path ADR-04 exists
 *    to keep out of financial code.
 *
 * Nothing here touches a provider or the network.
 */

import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { currency, Money, toDbString as moneyToDbString } from '@/lib/decimal/money';
import { Quantity } from '@/lib/decimal/quantity';
import { Rate } from '@/lib/decimal/rate';
import { UnitPrice, pToDbString } from '@/lib/decimal/price';
import {
  diagnosticReplacer,
  formatScaledDecimal,
  toDiagnosticJson,
} from '@/lib/format/diagnostic-json';
import type {
  CorporateActionObservation,
  FxObservation,
  PriceObservation,
} from '@/server/market-data/types';

const INR = currency('INR');
const USD = currency('USD');

const observation = (over: Partial<PriceObservation> = {}): PriceObservation => ({
  instrumentId: 'i-infy',
  close: UnitPrice.of('1121.00000000'),
  currency: INR,
  tradingDate: isoDate('2026-08-21'),
  observedAt: new Date('2026-08-21T10:00:00.000Z'),
  kind: 'eod',
  source: 'twelvedata:XNSE',
  providerRef: 'INFY',
  ...over,
});

describe('the exact defect that broke the smoke test', () => {
  it('plain JSON.stringify still throws — so the fix is needed, not incidental', () => {
    // Pinned deliberately: if a future runtime made this work, the replacer
    // would look like dead code and someone would remove it.
    expect(() => JSON.stringify(observation())).toThrow(/BigInt/);
  });

  it('the diagnostic serializer does not throw on the same value', () => {
    expect(() => toDiagnosticJson(observation())).not.toThrow();
  });

  it('renders the live figure that was being reported when it crashed', () => {
    const json = JSON.parse(toDiagnosticJson(observation())) as Record<string, unknown>;
    expect(json['close']).toBe('1121.00000000');
    expect(json['tradingDate']).toBe('2026-08-21');
    expect(json['observedAt']).toBe('2026-08-21T10:00:00.000Z');
    expect(json['source']).toBe('twelvedata:XNSE');
  });
});

describe('exactness — never a float, never a truncation', () => {
  it('a price renders at its own scale, matching the database representation', () => {
    const price = UnitPrice.of('1592.35000000');
    expect(formatScaledDecimal(price)).toBe(pToDbString(price));
  });

  it('money keeps its currency alongside the figure', () => {
    const amount = Money.of('636940', INR);
    expect(formatScaledDecimal(amount)).toBe(`${moneyToDbString(amount)} INR`);
    // A bare number would let a rupee figure be read as a dollar one.
    expect(formatScaledDecimal(Money.of('636940', USD))).toContain('USD');
  });

  it('a rate renders at scale 10', () => {
    expect(formatScaledDecimal(Rate.of('95.61'))).toBe('95.6100000000');
  });

  it('a quantity renders at scale 8, like a price', () => {
    expect(formatScaledDecimal(Quantity.of('400'))).toBe('400.00000000');
  });

  it('survives a value far beyond Number.MAX_SAFE_INTEGER without losing a digit', () => {
    // 2^53 is 9007199254740992. This is comfortably past it, and every digit
    // must survive — the exact case `Number()` would corrupt.
    const huge = UnitPrice.fromUnits(123456789012345678901n / 10n);
    const rendered = formatScaledDecimal(huge)!;
    expect(rendered).toBe(pToDbString(huge));
    expect(rendered.replace('.', '')).toContain('1234567890123456789'.slice(0, 18));
    // The float round-trip that must never be used would change this.
    expect(rendered).not.toBe(String(Number(rendered)));
  });

  it('renders zero without collapsing it to an empty or bare 0', () => {
    expect(formatScaledDecimal(UnitPrice.zero())).toBe('0.00000000');
    expect(formatScaledDecimal(Money.zero(INR))).toBe('0.0000 INR');
    expect(formatScaledDecimal(Quantity.zero())).toBe('0.00000000');
  });

  it('renders a negative figure with its sign intact', () => {
    expect(formatScaledDecimal(Money.fromMinor(-2369400000n, INR))).toBe('-236940.0000 INR');
  });

  it('preserves trailing zeros, which carry precision', () => {
    // "1121.00000000" and "1121" are the same quantity but not the same claim
    // about precision, and the database holds the former.
    expect(formatScaledDecimal(UnitPrice.of('1121'))).toBe('1121.00000000');
  });
});

describe('every normalized market-data result serializes', () => {
  it('a quote observation', () => {
    expect(() => toDiagnosticJson(observation())).not.toThrow();
  });

  it('a historical series, including its ends', () => {
    const series: PriceObservation[] = [
      observation({ tradingDate: isoDate('2026-01-01'), close: UnitPrice.of('0') }),
      observation({ tradingDate: isoDate('2026-08-21'), close: UnitPrice.of('99999999.99999999') }),
    ];
    const json = JSON.parse(toDiagnosticJson(series)) as Record<string, unknown>[];
    expect(json[0]!['close']).toBe('0.00000000');
    expect(json[1]!['close']).toBe('99999999.99999999');
  });

  it('a 160-session series, the size the live run returned', () => {
    const series = Array.from({ length: 160 }, (_, i) =>
      observation({ close: UnitPrice.fromUnits(BigInt(i) * 100_000_000n) }),
    );
    expect(() => toDiagnosticJson(series)).not.toThrow();
    expect(JSON.parse(toDiagnosticJson(series))).toHaveLength(160);
  });

  it('an FX observation, whose rate is scale 10', () => {
    const fx: FxObservation = {
      base: USD,
      quote: INR,
      rate: Rate.of('95.61'),
      asOf: isoDate('2026-08-21'),
      source: 'frankfurter',
    };
    const json = JSON.parse(toDiagnosticJson(fx)) as Record<string, unknown>;
    expect(json['rate']).toBe('95.6100000000');
  });

  it('a corporate-action observation, whose ratio is an ordinary integer', () => {
    const action: CorporateActionObservation = {
      instrumentId: 'i-infy',
      kind: 'split',
      exDate: isoDate('2026-06-01'),
      ratioNum: 5,
      ratioDen: 1,
      source: 'twelvedata:XNSE',
    };
    const json = JSON.parse(toDiagnosticJson(action)) as Record<string, unknown>;
    // Numbers stay numbers; only bigints are rewritten.
    expect(json['ratioNum']).toBe(5);
    expect(json['ratioDen']).toBe(1);
  });

  it('the exact shape the smoke test serializes for its leak check', () => {
    const payload = {
      metadata: { name: 'Infosys Ltd', currency: INR, exchange: 'XNSE', isin: null, assetClass: 'equity', providerSymbol: 'INFY' },
      quote: observation(),
      history: [observation(), observation()],
      actions: [] as CorporateActionObservation[],
    };
    expect(() => toDiagnosticJson(payload)).not.toThrow();
    // And it is searchable as text, which is what the leak check depends on.
    expect(toDiagnosticJson(payload)).toContain('1121.00000000');
  });
});

describe('robustness at the boundary', () => {
  it('handles a bare bigint losslessly, without guessing a scale', () => {
    const json = JSON.parse(toDiagnosticJson({ counter: 9007199254740993n })) as Record<string, unknown>;
    // One past 2^53. As a string it is exact; as a Number it would be 9007199254740992.
    expect(json['counter']).toBe('9007199254740993');
  });

  it('leaves ordinary values untouched', () => {
    const json = JSON.parse(
      toDiagnosticJson({ s: 'x', n: 1.5, b: true, nul: null, arr: [1, 2], nested: { k: 'v' } }),
    ) as Record<string, unknown>;
    expect(json).toEqual({ s: 'x', n: 1.5, b: true, nul: null, arr: [1, 2], nested: { k: 'v' } });
  });

  it('does not mistake an unrelated object for a scaled decimal', () => {
    // `value` is a common property name; only a bigint one is a Rate.
    expect(formatScaledDecimal({ value: 42 })).toBeNull();
    expect(formatScaledDecimal({ units: 'many' })).toBeNull();
    expect(formatScaledDecimal({ minor: 100n })).toBeNull(); // Money needs its currency
    expect(formatScaledDecimal(null)).toBeNull();
    expect(formatScaledDecimal('1121')).toBeNull();
  });

  it('is usable directly as a JSON.stringify replacer', () => {
    expect(() => JSON.stringify(observation(), diagnosticReplacer)).not.toThrow();
    expect(JSON.stringify(observation(), diagnosticReplacer, 2)).toContain('1121.00000000');
  });

  it('honours the indent argument, so a diagnostic can be read by a human', () => {
    expect(toDiagnosticJson({ price: UnitPrice.of('1') }, 2)).toBe('{\n  "price": "1.00000000"\n}');
  });
});
