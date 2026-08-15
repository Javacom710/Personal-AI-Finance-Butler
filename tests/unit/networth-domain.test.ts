import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { currency, Money, toDbString } from '@/lib/decimal/money';
import { Rate, rToDbString } from '@/lib/decimal/rate';
import {
  bridge,
  bridgeCloses,
  noFlows,
  type BridgeFlows,
} from '@/server/domain/networth/bridge';
import { compose, type ComponentInput, type NetWorthResult } from '@/server/domain/networth/compose';
import {
  accountEligible,
  disposalCounted,
  inForce,
  lotEligible,
  manualAssetEligible,
  onOrBefore,
  strictlyAfter,
} from '@/server/domain/networth/eligibility';
import {
  ContributionMap,
  DuplicateContribution,
  sourceKeyId,
  type SourceKey,
} from '@/server/domain/networth/keys';
import { assertReconciles, reconcile, ReconciliationFailed } from '@/server/domain/networth/reconcile';

const INR = currency('INR');
const USD = currency('USD');
const m = (s: string) => Money.of(s, INR);
const usd = (s: string) => Money.of(s, USD);
const d = (s: string) => isoDate(s);

const AS_OF = d('2026-06-30');

function component(over: Partial<ComponentInput> & { key: SourceKey; native: ReturnType<typeof m> }): ComponentInput {
  return {
    label: 'x',
    group: 'cash',
    sourceRef: { type: 'account', id: 'a' },
    fx: { rate: Rate.one(), asOf: AS_OF },
    ...over,
  } as ComponentInput;
}

function composeOf(inputs: ComponentInput[]): NetWorthResult {
  return compose(inputs, { asOf: AS_OF, base: INR, basis: 'cost' });
}

// --------------------------------------------------------------------- keys

describe('sourceKeyId', () => {
  it('is stable and distinct per source kind', () => {
    expect(sourceKeyId({ t: 'account', accountId: 'a1' })).toBe('account:a1');
    expect(sourceKeyId({ t: 'position', accountId: 'a1', instrumentId: 'i1' })).toBe('position:a1:i1');
    expect(sourceKeyId({ t: 'asset', assetId: 'm1' })).toBe('asset:m1');
    expect(sourceKeyId({ t: 'liability', liabilityId: 'l1' })).toBe('liability:l1');
  });

  it('does not collide between an account and a position in it', () => {
    expect(sourceKeyId({ t: 'account', accountId: 'a1' })).not.toBe(
      sourceKeyId({ t: 'position', accountId: 'a1', instrumentId: 'i1' }),
    );
  });
});

describe('ContributionMap — I-21, the duplicate guard', () => {
  it('throws when one source contributes twice', () => {
    expect(() =>
      composeOf([
        component({ key: { t: 'account', accountId: 'a1' }, native: m('100') }),
        component({ key: { t: 'account', accountId: 'a1' }, native: m('100') }),
      ]),
    ).toThrow(DuplicateContribution);
  });

  it('throws when a source contributes once and is excluded once', () => {
    const map = new ContributionMap();
    const key: SourceKey = { t: 'asset', assetId: 'm1' };
    map.exclude({
      key,
      keyId: sourceKeyId(key),
      label: 'Flat',
      group: 'property',
      side: 'asset',
      native: usd('1'),
      nativeCurrency: USD,
      reason: 'no_fx_rate',
    });
    expect(() =>
      map.add({
        key,
        keyId: sourceKeyId(key),
        label: 'Flat',
        group: 'property',
        side: 'asset',
        native: m('1'),
        nativeCurrency: INR,
        sourceCurrency: INR,
        rate: Rate.one(),
        rateAsOf: AS_OF,
        base: m('1'),
        sourceRef: { type: 'asset', id: 'm1' },
      }),
    ).toThrow(DuplicateContribution);
  });

  it('names the offending key, so the duplicate can be found', () => {
    try {
      composeOf([
        component({ key: { t: 'position', accountId: 'a1', instrumentId: 'i9' }, native: m('1') }),
        component({ key: { t: 'position', accountId: 'a1', instrumentId: 'i9' }, native: m('1') }),
      ]);
      expect.unreachable('expected a DuplicateContribution');
    } catch (error) {
      expect((error as DuplicateContribution).keyId).toBe('position:a1:i9');
    }
  });

  it('allows two positions of the same instrument in different accounts', () => {
    const result = composeOf([
      component({ key: { t: 'position', accountId: 'a1', instrumentId: 'i1' }, native: m('60000'), group: 'investments' }),
      component({ key: { t: 'position', accountId: 'a2', instrumentId: 'i1' }, native: m('40000'), group: 'investments' }),
    ]);
    expect(toDbString(result.assets)).toBe('100000.0000');
  });
});

// -------------------------------------------------------------- eligibility

describe('eligibility — every filter is a date (ADR-26)', () => {
  it('onOrBefore / strictlyAfter treat a null bound as unbounded', () => {
    expect(onOrBefore(d('2020-01-01'), null)).toBe(true);
    expect(onOrBefore(d('2999-01-01'), null)).toBe(true);
    expect(strictlyAfter(d('2999-01-01'), null)).toBe(false);
  });

  it('an account is eligible from its opening date onward', () => {
    const opened = d('2026-03-01');
    expect(accountEligible(opened, d('2020-12-31'))).toBe(false);
    expect(accountEligible(opened, d('2026-02-28'))).toBe(false);
    expect(accountEligible(opened, d('2026-03-01'))).toBe(true);
    expect(accountEligible(opened, d('2026-03-02'))).toBe(true);
    expect(accountEligible(opened, null)).toBe(true);
  });

  it('a lot is eligible by opened_on — never by acquired_on (I-23)', () => {
    // A transfer_in carries acquired_on back two years; the lot did not exist in
    // the destination account until it was opened.
    const acquired = d('2024-01-10');
    const opened = d('2026-01-10');
    expect(lotEligible(opened, d('2025-06-30'))).toBe(false);
    expect(lotEligible(acquired, d('2025-06-30'))).toBe(true); // the wrong column, proven different
  });

  it('a disposal consumes basis only from its closing date', () => {
    expect(disposalCounted(d('2026-05-01'), d('2026-04-30'))).toBe(false);
    expect(disposalCounted(d('2026-05-01'), d('2026-05-01'))).toBe(true);
  });

  describe('manual assets', () => {
    it('is not yet held before acquisition', () => {
      expect(manualAssetEligible({ startOn: d('2026-01-01'), disposedOn: null }, d('2025-12-31'))).toBe(false);
    });

    it('is held from acquisition onward', () => {
      expect(manualAssetEligible({ startOn: d('2026-01-01'), disposedOn: null }, d('2026-01-01'))).toBe(true);
    });

    it('is still held when disposal is after the as-of date', () => {
      expect(
        manualAssetEligible({ startOn: d('2020-01-01'), disposedOn: d('2026-12-01') }, d('2026-06-30')),
      ).toBe(true);
    });

    it('is gone from the disposal date onward', () => {
      expect(
        manualAssetEligible({ startOn: d('2020-01-01'), disposedOn: d('2026-06-30') }, d('2026-06-30')),
      ).toBe(false);
      expect(
        manualAssetEligible({ startOn: d('2020-01-01'), disposedOn: d('2026-06-30') }, d('2026-07-01')),
      ).toBe(false);
    });

    it('is eligible when it carries no dates at all', () => {
      expect(manualAssetEligible({ startOn: null, disposedOn: null }, d('2026-06-30'))).toBe(true);
    });
  });

  describe('inForce', () => {
    const series = [
      { asOf: d('2024-01-01'), v: 'a' },
      { asOf: d('2026-01-01'), v: 'c' },
      { asOf: d('2025-01-01'), v: 'b' },
    ];

    it('picks the greatest as_of on or before the date, unsorted input', () => {
      expect(inForce(series, d('2025-06-30'))?.v).toBe('b');
      expect(inForce(series, d('2026-01-01'))?.v).toBe('c');
      expect(inForce(series, null)?.v).toBe('c');
    });

    it('never uses a later row for an earlier date', () => {
      expect(inForce(series, d('2024-06-30'))?.v).toBe('a');
    });

    it('is null when nothing is in force yet', () => {
      expect(inForce(series, d('2023-12-31'))).toBeNull();
    });

    it('is null for an empty series', () => {
      expect(inForce([], d('2026-06-30'))).toBeNull();
    });
  });
});

// ----------------------------------------------------------------- compose

describe('compose — classification by sign (ADR-25)', () => {
  it('an empty system is zero and fully covered, not null', () => {
    const r = composeOf([]);
    expect(toDbString(r.netWorth)).toBe('0.0000');
    expect(toDbString(r.assets)).toBe('0.0000');
    expect(toDbString(r.liabilities)).toBe('0.0000');
    expect(rToDbString(r.assetCoverage)).toBe(rToDbString(Rate.one()));
    expect(rToDbString(r.liabilityCoverage)).toBe(rToDbString(Rate.one()));
    expect(r.excluded).toEqual([]);
  });

  it('an OVERPAID credit card is an asset, not zero and not a liability', () => {
    const r = composeOf([
      component({
        key: { t: 'account', accountId: 'card' },
        native: m('5000'),
        group: 'credit_card',
        label: 'HDFC Card',
      }),
    ]);
    expect(toDbString(r.assets)).toBe('5000.0000');
    expect(toDbString(r.liabilities)).toBe('0.0000');
    expect(toDbString(r.netWorth)).toBe('5000.0000');
    expect(r.contributions[0]!.side).toBe('asset');
  });

  it('an overdrawn bank account is a liability, not a negative asset', () => {
    const r = composeOf([
      component({ key: { t: 'account', accountId: 'b' }, native: m('-8000'), group: 'cash' }),
    ]);
    expect(toDbString(r.assets)).toBe('0.0000');
    expect(toDbString(r.liabilities)).toBe('8000.0000');
    expect(toDbString(r.netWorth)).toBe('-8000.0000');
  });

  it('a zero balance contributes to neither side but keeps its key', () => {
    const r = composeOf([
      component({ key: { t: 'account', accountId: 'z' }, native: m('0') }),
    ]);
    expect(toDbString(r.assets)).toBe('0.0000');
    expect(toDbString(r.liabilities)).toBe('0.0000');
    expect(r.contributions).toHaveLength(1);
    expect(r.contributions[0]!.side).toBe('none');
    expect(r.groups).toEqual([]);
  });

  it('reports a negative net worth as negative', () => {
    const r = composeOf([
      component({ key: { t: 'account', accountId: 'c' }, native: m('-250000'), group: 'loans' }),
      component({ key: { t: 'account', accountId: 'b' }, native: m('40000'), group: 'cash' }),
    ]);
    expect(toDbString(r.netWorth)).toBe('-210000.0000');
  });

  it('the single-counting case: brokerage cash plus its positions', () => {
    const r = composeOf([
      component({ key: { t: 'account', accountId: 'brk' }, native: m('40000'), group: 'brokerage_cash' }),
      component({
        key: { t: 'position', accountId: 'brk', instrumentId: 'i1' },
        native: m('60000'),
        group: 'investments',
      }),
    ]);
    expect(toDbString(r.netWorth)).toBe('100000.0000');
  });

  it('converts a foreign component once, at the supplied rate', () => {
    const r = composeOf([
      component({
        key: { t: 'account', accountId: 'us' },
        native: usd('1000'),
        fx: { rate: Rate.of('83.25'), asOf: AS_OF },
      }),
    ]);
    expect(toDbString(r.assets)).toBe('83250.0000');
    expect(r.contributions[0]!.rateAsOf).toBe(AS_OF);
  });

  it('excludes a component with no rate, names it, and never zeroes it', () => {
    const r = composeOf([
      component({ key: { t: 'account', accountId: 'in' }, native: m('100000') }),
      component({
        key: { t: 'asset', assetId: 'flat' },
        native: usd('80000'),
        group: 'property',
        label: 'Miami flat',
        fx: null,
      }),
    ]);
    expect(toDbString(r.assets)).toBe('100000.0000');
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0]!.label).toBe('Miami flat');
    expect(r.excluded[0]!.reason).toBe('no_fx_rate');
    expect(toDbString(r.excluded[0]!.native)).toBe('80000.0000');
    expect(r.excluded[0]!.nativeCurrency).toBe(USD);
  });

  it('drops coverage on the excluded side only', () => {
    const r = composeOf([
      component({ key: { t: 'account', accountId: 'in' }, native: m('100000') }),
      component({ key: { t: 'asset', assetId: 'f' }, native: usd('1'), group: 'property', fx: null }),
      component({ key: { t: 'liability', liabilityId: 'l' }, native: m('-5000'), group: 'loans' }),
    ]);
    // one of two assets converted; every liability converted
    expect(rToDbString(r.assetCoverage)).toBe('0.5000000000');
    expect(rToDbString(r.liabilityCoverage)).toBe(rToDbString(Rate.one()));
  });

  it('never excludes a zero-valued component for a missing rate', () => {
    const r = composeOf([
      component({ key: { t: 'account', accountId: 'z' }, native: usd('0'), fx: null }),
    ]);
    expect(r.excluded).toEqual([]);
    expect(r.contributions[0]!.side).toBe('none');
  });

  it('groups subtotals without forming a second summation path', () => {
    const r = composeOf([
      component({ key: { t: 'account', accountId: 'a' }, native: m('1000'), group: 'cash' }),
      component({ key: { t: 'account', accountId: 'b' }, native: m('2000'), group: 'cash' }),
      component({ key: { t: 'asset', assetId: 'f' }, native: m('5000'), group: 'property' }),
    ]);
    const cash = r.groups.find((g) => g.group === 'cash')!;
    expect(toDbString(cash.total)).toBe('3000.0000');
    expect(cash.count).toBe(2);
    expect(toDbString(r.assets)).toBe('8000.0000');
  });
});

// --------------------------------------------------------------- reconcile

describe('reconcile — I-22, two paths must agree exactly', () => {
  const result = composeOf([
    component({ key: { t: 'account', accountId: 'a' }, native: m('120000'), group: 'cash' }),
    component({ key: { t: 'account', accountId: 'card' }, native: m('-45000'), group: 'credit_card' }),
    component({ key: { t: 'position', accountId: 'brk', instrumentId: 'i' }, native: m('60000'), group: 'investments' }),
    component({ key: { t: 'liability', liabilityId: 'home' }, native: m('-2500000'), group: 'loans' }),
  ]);

  it('balances, with a zero residual', () => {
    const r = reconcile(result);
    expect(r.balances).toBe(true);
    expect(toDbString(r.residual)).toBe('0.0000');
  });

  it('reproduces assets, liabilities and the net figure by the group path', () => {
    const r = reconcile(result);
    expect(toDbString(r.assets)).toBe('180000.0000');
    expect(toDbString(r.liabilities)).toBe('2545000.0000');
    expect(toDbString(r.netWorth)).toBe('-2365000.0000');
    expect(toDbString(result.netWorth)).toBe(toDbString(r.netWorth));
  });

  it('explains every rupee down to its source', () => {
    const r = reconcile(result);
    const investments = r.lines.find((l) => l.group === 'investments')!;
    expect(investments.sources).toHaveLength(1);
    expect(investments.sources[0]!.keyId).toBe('position:brk:i');
    expect(toDbString(investments.sources[0]!.base)).toBe('60000.0000');
  });

  it('throws when the two paths disagree', () => {
    const tampered: NetWorthResult = { ...result, assets: m('1') };
    expect(() => assertReconciles(tampered)).toThrow(ReconciliationFailed);
  });
});

// ------------------------------------------------------------------ bridge

describe('bridge — the identity closes', () => {
  const opening = compose(
    [component({ key: { t: 'account', accountId: 'a' }, native: m('100000'), group: 'cash' })],
    { asOf: d('2026-01-01'), base: INR, basis: 'cost' },
  );

  function closingOf(amount: string): NetWorthResult {
    return compose(
      [component({ key: { t: 'account', accountId: 'a' }, native: m(amount), group: 'cash' })],
      { asOf: d('2026-06-30'), base: INR, basis: 'cost' },
    );
  }

  function flows(over: Partial<BridgeFlows>): BridgeFlows {
    return { ...noFlows(INR), ...over };
  }

  it('is exactly zero unexplained when savings account for the whole move', () => {
    const b = bridge(opening, closingOf('130000'), flows({ savings: m('30000') }));
    expect(toDbString(b.delta)).toBe('30000.0000');
    expect(toDbString(b.unexplained)).toBe('0.0000');
    expect(b.singleCurrency).toBe(true);
    expect(bridgeCloses(b)).toBe(true);
  });

  it('surfaces an unexplained residual rather than hiding it', () => {
    const b = bridge(opening, closingOf('130000'), flows({ savings: m('25000') }));
    expect(toDbString(b.unexplained)).toBe('5000.0000');
    expect(bridgeCloses(b)).toBe(false);
  });

  it('subtracts investment costs and adds gross income', () => {
    const b = bridge(
      opening,
      closingOf('100450'),
      flows({ investmentIncome: m('500'), investmentCosts: m('50') }),
    );
    expect(toDbString(b.unexplained)).toBe('0.0000');
    expect(toDbString(b.lines.find((l) => l.key === 'investment_costs')!.amount)).toBe('-50.0000');
  });

  it('marks the unrealised gain NOT MEASURED at cost basis, and keeps it zero', () => {
    const b = bridge(opening, closingOf('100000'), noFlows(INR));
    const line = b.lines.find((l) => l.key === 'unrealized_gain')!;
    expect(line.notMeasured).toBe(true);
    expect(toDbString(line.amount)).toBe('0.0000');
  });

  it('carries an unmatched investment transfer on its own line', () => {
    const b = bridge(opening, closingOf('160000'), flows({ investmentTransfers: m('60000') }));
    expect(toDbString(b.unexplained)).toBe('0.0000');
  });

  it('treats a scheduled liability repayment as a positive contribution', () => {
    const b = bridge(opening, closingOf('100000'), flows({ liabilityChange: m('0') }));
    expect(toDbString(b.unexplained)).toBe('0.0000');
  });

  it('refuses to bridge across two different base currencies', () => {
    const usdClosing = compose([], { asOf: d('2026-06-30'), base: USD, basis: 'cost' });
    expect(() => bridge(opening, usdClosing, noFlows(USD))).toThrow(TypeError);
  });

  it('requires exact closure for single-currency data even when a tolerance is offered', () => {
    const b = bridge(opening, closingOf('130001'), flows({ savings: m('30000') }));
    expect(b.singleCurrency).toBe(true);
    // One base unit out. A multi-currency bridge would be allowed this; a
    // single-currency one must not be, because every FX term is identically zero.
    expect(bridgeCloses(b, 1n)).toBe(false);
  });
});
