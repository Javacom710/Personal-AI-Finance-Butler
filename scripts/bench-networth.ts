/**
 * `npm run bench:networth` — the Phase 6.11 performance measurement, repeated.
 *
 * Reproduces the methodology of
 * [MARKET-VALUE-NET-WORTH-DESIGN.md §12](../docs/MARKET-VALUE-NET-WORTH-DESIGN.md#12-snapshots--closed-by-measurement)
 * so the numbers in that document can be checked against the code rather than
 * trusted: **the real domain functions over synthetic data**, at a portfolio
 * deliberately larger than the target user's, timing the **per-point fold**.
 * `loadSources()` runs once per series by design (D-31) and does not scale with
 * point count, so it is not what a series' cost is made of.
 *
 * ```
 * 8 accounts · 40 instruments · 480 lots · 100,000 price points · 2,500 FX rows
 * ```
 *
 * The figure that decided **OD-15** is the last pair. A 365-point market series
 * over a naive linear price scan measured 1,156 ms; sorting each instrument's
 * series once and binary-searching per point measured 123 ms. That 9× is why
 * `net_worth_snapshots` was closed rather than built: the cost was an
 * implementation choice, not a property of the problem, and a second stored
 * representation of a derived figure is not the answer to a missing sort
 * ([ADR-24](../docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)).
 *
 * **No database, no network, no clock-dependent input.** Everything below is
 * built in memory from a fixed seed, so two runs on one machine are comparable
 * and a regression is visible rather than inferred.
 */

import { addDays, compareDates, isoDate, type IsoDate } from '../src/lib/date';
import { Money, currency, mulRate, type CurrencyCode } from '../src/lib/decimal/money';
import { Quantity, type Quantity as Qty } from '../src/lib/decimal/quantity';
import { Rate } from '../src/lib/decimal/rate';
import { UnitPrice, valueOf } from '../src/lib/decimal/price';
import { compose, type ComponentInput } from '../src/server/domain/networth/compose';
import { reconcile } from '../src/server/domain/networth/reconcile';
import { emptyMarketSummary } from '../src/server/domain/networth/market';
import { indexCloses, type CloseObservation } from '../src/server/domain/pricing/price-series';
import { quantityHeldOn } from '../src/server/domain/lots/quantity';
import { rateSelector, type FxRateRow } from '../src/server/domain/fx';
import { lotEligible } from '../src/server/domain/networth/eligibility';

const INR = currency('INR');
const USD = currency('USD');

const ACCOUNTS = 8;
const INSTRUMENTS = 40;
const LOTS = 480;
const PRICE_POINTS_PER_INSTRUMENT = 2_500;
const FX_ROWS = 2_500;

const START = isoDate('2016-08-14');
const TODAY = isoDate('2026-08-14');

/**
 * A deterministic generator. `Math.random()` would make two runs
 * incomparable, which is the one thing a benchmark must not be.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

// ------------------------------------------------------------------ the data

interface SyntheticLot {
  readonly accountIndex: number;
  readonly instrumentIndex: number;
  readonly openedOn: IsoDate;
  readonly baseCostMinor: bigint;
  readonly instrumentCostMinor: bigint;
}

interface SyntheticInstrument {
  readonly id: string;
  readonly currency: CurrencyCode;
  readonly closes: readonly CloseObservation[];
  readonly timeline: readonly { readonly on: IsoDate; readonly quantity: Qty }[];
}

function build() {
  const random = lcg(20_260_821);

  const instruments: SyntheticInstrument[] = [];
  for (let i = 0; i < INSTRUMENTS; i += 1) {
    const closes: CloseObservation[] = [];
    // Sessions every 1–2 days, so ten years of history lands near 2,500 points.
    let on = START;
    for (let p = 0; p < PRICE_POINTS_PER_INSTRUMENT; p += 1) {
      closes.push({
        asOf: on,
        close: `${(100 + random() * 900).toFixed(8)}`,
      });
      on = addDays(on, random() < 0.7 ? 1 : 2);
    }
    // Deliberately shuffled: the index must sort, and the naive scan must not
    // be handed a sorted array it did not earn.
    closes.sort(() => random() - 0.5);

    // One checkpoint per trade, ratio-aware quantities already folded — this is
    // what `replay()` emits, and what a series binary-searches per point.
    const timeline: { on: IsoDate; quantity: Qty }[] = [];
    let units = 0n;
    let tradeOn = START;
    for (let t = 0; t < 24; t += 1) {
      units += BigInt(Math.floor(random() * 50 + 1)) * 100_000_000n;
      timeline.push({ on: tradeOn, quantity: Quantity.fromUnits(units) });
      tradeOn = addDays(tradeOn, 150);
    }

    instruments.push({
      id: `instrument-${i}`,
      currency: i % 5 === 0 ? USD : INR,
      closes,
      timeline,
    });
  }

  const lots: SyntheticLot[] = [];
  for (let l = 0; l < LOTS; l += 1) {
    lots.push({
      accountIndex: l % ACCOUNTS,
      instrumentIndex: l % INSTRUMENTS,
      openedOn: addDays(START, Math.floor(random() * 3_600)),
      baseCostMinor: BigInt(Math.floor(random() * 5_000_000) + 10_000) * 100n,
      instrumentCostMinor: BigInt(Math.floor(random() * 60_000) + 1_000) * 100n,
    });
  }

  const fx: FxRateRow[] = [];
  let fxOn = START;
  for (let r = 0; r < FX_ROWS; r += 1) {
    fx.push({
      baseCode: USD,
      quoteCode: INR,
      asOf: fxOn,
      rate: Rate.of((70 + random() * 15).toFixed(10)),
    });
    fxOn = addDays(fxOn, 1);
  }

  const accountBalances = Array.from({ length: ACCOUNTS }, () =>
    BigInt(Math.floor(random() * 20_000_000) + 100_000) * 100n,
  );

  return { instruments, lots, fx, accountBalances };
}

const DATA = build();

/** Built once, as `createFxLookup` builds it once per request. */
const FX = rateSelector(DATA.fx);

// ------------------------------------------------------------------ the folds

/** Positions at `asOf`, from the lot table bounded by `opened_on`. The cost path. */
function positionCostsAt(asOf: IsoDate): Map<string, { base: bigint; instrument: bigint; i: number }> {
  const out = new Map<string, { base: bigint; instrument: bigint; i: number }>();
  for (const lot of DATA.lots) {
    if (!lotEligible(lot.openedOn, asOf)) continue;
    const key = `${lot.accountIndex}:${lot.instrumentIndex}`;
    const existing = out.get(key);
    if (existing) {
      existing.base += lot.baseCostMinor;
      existing.instrument += lot.instrumentCostMinor;
    } else {
      out.set(key, {
        base: lot.baseCostMinor,
        instrument: lot.instrumentCostMinor,
        i: lot.instrumentIndex,
      });
    }
  }
  return out;
}

function accountComponents(asOf: IsoDate): ComponentInput[] {
  return DATA.accountBalances.map((minor, index) => ({
    key: { t: 'account', accountId: `account-${index}` },
    label: `Account ${index}`,
    group: 'cash',
    native: Money.fromMinor(minor, INR),
    sourceRef: { type: 'account', id: `account-${index}` },
    fx: { rate: Rate.one(), asOf },
  }));
}

function costComponents(asOf: IsoDate): ComponentInput[] {
  const out = accountComponents(asOf);
  for (const [key, position] of positionCostsAt(asOf)) {
    const [accountIndex, instrumentIndex] = key.split(':') as [string, string];
    out.push({
      key: {
        t: 'position',
        accountId: `account-${accountIndex}`,
        instrumentId: `instrument-${instrumentIndex}`,
      },
      label: key,
      group: 'investments',
      native: Money.fromMinor(position.base, INR),
      sourceRef: { type: 'instrument', id: `instrument-${instrumentIndex}` },
      fx: { rate: Rate.one(), asOf },
    });
  }
  return out;
}

type PriceLookup = (instrument: SyntheticInstrument, asOf: IsoDate) => UnitPrice | null;

/** The V1 path: sort once per instrument, binary-search per point. */
function indexedLookup(): { lookup: PriceLookup; scanned: () => number } {
  const indexes = new Map(DATA.instruments.map((i) => [i.id, indexCloses(i.closes, 'eod')]));
  return {
    lookup: (instrument, asOf) => indexes.get(instrument.id)!.closeAsOf(asOf)?.close ?? null,
    scanned: () => [...indexes.values()].reduce((sum, index) => sum + index.scanned, 0),
  };
}

/**
 * The path the design measured at 1,156 ms, kept so the comparison is a
 * measurement rather than a claim: greatest `as_of <= on` by scanning the whole
 * series, every point, every instrument.
 */
function naiveLookup(): { lookup: PriceLookup; scanned: () => number } {
  let scanned = 0;
  return {
    lookup: (instrument, asOf) => {
      let best: CloseObservation | null = null;
      for (const point of instrument.closes) {
        scanned += 1;
        const on = isoDate(point.asOf);
        if (compareDates(on, asOf) > 0) continue;
        if (best === null || compareDates(on, isoDate(best.asOf)) > 0) best = point;
      }
      return best === null ? null : UnitPrice.fromDbString(best.close);
    },
    scanned: () => scanned,
  };
}

function marketComponents(asOf: IsoDate, lookup: PriceLookup): ComponentInput[] {
  const out = accountComponents(asOf);

  for (const [key, position] of positionCostsAt(asOf)) {
    const [accountIndex, instrumentIndex] = key.split(':') as [string, string];
    const instrument = DATA.instruments[Number(instrumentIndex)]!;
    const sourceKey = {
      t: 'position' as const,
      accountId: `account-${accountIndex}`,
      instrumentId: instrument.id,
    };

    const quantity = quantityHeldOn(instrument.timeline, asOf);
    const price = lookup(instrument, asOf);
    const rate =
      instrument.currency === INR
        ? { ok: true as const, value: { rate: Rate.one(), asOf } }
        : FX(instrument.currency, INR, asOf);

    if (price === null || !rate.ok) {
      out.push({
        key: sourceKey,
        label: key,
        group: 'investments',
        native: Money.fromMinor(position.base, INR),
        sourceRef: { type: 'instrument', id: instrument.id },
        fx: null,
        excluded: price === null ? 'no_price_on_date' : 'no_fx_rate',
      });
      continue;
    }

    out.push({
      key: sourceKey,
      label: key,
      group: 'investments',
      native: valueOf(quantity, price, instrument.currency, 'half_up'),
      sourceRef: { type: 'instrument', id: instrument.id },
      fx: { rate: rate.value.rate, asOf: rate.value.asOf },
      sourceCurrency: instrument.currency,
    });
    // The restatement's `costAtSpot`, computed on the same pass the real builder
    // computes it on, so the measurement covers the work the phase actually does.
    mulRate(Money.fromMinor(position.instrument, INR), rate.value.rate, 'half_up');
  }

  return out;
}

const costPoint = (asOf: IsoDate) =>
  compose(costComponents(asOf), { asOf, base: INR, basis: 'cost' });

const marketPoint = (asOf: IsoDate, lookup: PriceLookup) =>
  compose(marketComponents(asOf, lookup), {
    asOf,
    base: INR,
    basis: 'market',
    market: emptyMarketSummary(INR),
  });

// --------------------------------------------------------------- measurement

function dates(count: number): IsoDate[] {
  const step = count === 1 ? 0 : Math.floor(3_650 / count);
  return Array.from({ length: count }, (_, i) => addDays(TODAY, -(count - 1 - i) * (step || 1)));
}

interface Row {
  readonly operation: string;
  readonly ms: number;
  readonly scanned?: number;
}

function time(operation: string, run: () => void, scanned?: () => number): Row {
  // One warm-up pass, then the measured one: the first call through a fresh code
  // path is measuring the JIT, not the algorithm.
  run();
  const started = process.hrtime.bigint();
  run();
  const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
  return scanned === undefined ? { operation, ms } : { operation, ms, scanned: scanned() };
}

function main(): void {
  const one = [TODAY];
  const twelve = dates(12);
  const daily = dates(365);

  const rows: Row[] = [];

  rows.push(time('Net worth at cost, 1 point', () => one.forEach((d) => costPoint(d))));
  rows.push(
    time('Net worth at cost + reconcile, 1 point', () =>
      one.forEach((d) => reconcile(costPoint(d))),
    ),
  );

  {
    const { lookup } = indexedLookup();
    rows.push(time('Net worth at market, 1 point', () => one.forEach((d) => marketPoint(d, lookup))));
  }

  rows.push(time('12-point at-cost series', () => twelve.forEach((d) => costPoint(d))));

  {
    const { lookup } = indexedLookup();
    rows.push(
      time('12-point market-value series', () => twelve.forEach((d) => marketPoint(d, lookup))),
    );
  }

  rows.push(time('365-point at-cost series', () => daily.forEach((d) => costPoint(d))));

  {
    const naive = naiveLookup();
    rows.push(
      time(
        '365-point market-value series, naive price scan',
        () => daily.forEach((d) => marketPoint(d, naive.lookup)),
        naive.scanned,
      ),
    );
  }

  {
    const indexed = indexedLookup();
    rows.push(
      time(
        '365-point market-value series, indexed price lookup',
        () => daily.forEach((d) => marketPoint(d, indexed.lookup)),
        indexed.scanned,
      ),
    );
  }

  const observations = INSTRUMENTS * PRICE_POINTS_PER_INSTRUMENT;
  process.stdout.write(
    `\nNet-worth performance — ${ACCOUNTS} accounts, ${INSTRUMENTS} instruments, ` +
      `${LOTS} lots, ${observations.toLocaleString('en-US')} price points, ${FX_ROWS} FX rows\n\n`,
  );

  const width = Math.max(...rows.map((r) => r.operation.length));
  for (const row of rows) {
    const scanned =
      row.scanned === undefined
        ? ''
        : `   ${row.scanned.toLocaleString('en-US').padStart(12)} observations scanned`;
    process.stdout.write(
      `  ${row.operation.padEnd(width)}   ${row.ms.toFixed(1).padStart(8)} ms${scanned}\n`,
    );
  }

  const naive = rows.find((r) => r.operation.includes('naive'))!;
  const indexed = rows.find((r) => r.operation.includes('indexed'))!;
  const faster = (naive.ms / indexed.ms).toFixed(0);
  const fewer = (naive.scanned! / indexed.scanned!).toFixed(0);

  process.stdout.write(
    [
      '',
      `  Indexed lookup: ${faster}x faster, ${fewer}x fewer observations scanned.`,
      '',
      "  The gate is the INDEXED figure against the design's 123 ms (§12). The naive row is a",
      '  same-machine control for the SHAPE of the cost, not a reproduction of the design’s',
      '  1,156 ms: this scan validates each stored date, so its absolute number is its own.',
      '',
      '  A run materially slower than 123 ms on comparable hardware is a regression in a',
      '  lookup, not a case for a snapshot table (ADR-24, OD-15).',
      '',
      '',
    ].join('\n'),
  );
}

main();
