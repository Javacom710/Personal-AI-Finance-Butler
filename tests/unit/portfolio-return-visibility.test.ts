import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

import { Money, currency } from '@/lib/decimal/money';
import { Rate } from '@/lib/decimal/rate';
import { isoDate } from '@/lib/date';
import { metric } from '@/lib/metric';
import { canShowPortfolioReturns } from '@app/(app)/investments/_return-visibility';

const mocks = vi.hoisted(() => ({ portfolio: vi.fn(), instruments: vi.fn() }));

vi.mock('@/server/services', () => ({
  portfolio: mocks.portfolio,
  listInstruments: mocks.instruments,
  assetAllocation: async () => ({ slices: [], unpricedCount: 0 }),
  portfolioConcentration: async () => ({
    top1: {}, top3: {}, above10Pct: 0, holdingCount: 0, hhi: {},
  }),
  realizedDisposals: async () => [],
  describeMissing: () => 'No price',
}));
vi.mock('@app/(app)/money/_page-data', () => ({
  loadMoneyContext: async () => ({
    ctx: {},
    format: {
      money: (m: { minor: bigint }) => `money:${m.minor}`,
      metricPercent: (m: { value?: unknown }) => m.value ? 'return:999%' : 'allocation:known',
      reason: () => null,
      percent: () => 'coverage',
      date: () => 'date',
      dateShort: () => 'date',
    },
  }),
}));
vi.mock('@app/(app)/investments/actions', () => ({ rebuildPositionsAction: vi.fn() }));
vi.mock('@app/(app)/investments/_components', async (original) => {
  const actual = await original<Record<string, unknown>>();
  return {
    ...actual,
    HoldingRow: () => createElement('tr', null, createElement('td', null, 'Visible holding')),
  };
});

import InvestmentsPage from '@app/(app)/investments/page';
import PerformancePage from '@app/(app)/investments/performance/page';

const money = (value: string) => Money.fromDbString(value, currency('INR'));
const base = () => ({
  asOf: isoDate('2026-11-11'),
  investedCapital: money('1000'),
  costDeployed: money('1000'),
  marketValue: money('600'),
  unrealizedPnl: money('-400'),
  realizedPnl: money('10'),
  dividends: money('2'),
  interest: money('3'),
  fees: money('1'),
  taxes: money('1'),
  totalReturn: money('-387'),
  unrealizedReturnPct: metric(Rate.of('0')),
  totalReturnPct: metric(Rate.of('0')),
  xirr: metric(Rate.of('0')),
  twr: metric(Rate.of('0')),
  coverage: Rate.one(),
  unpricedInstruments: [{
    id: 'missing', symbol: 'MISSING', name: 'Missing', exchange: null,
    assetClass: 'equity' as const, currency: currency('INR'), country: null,
  }],
  staleInstruments: [],
});

beforeEach(() => {
  mocks.instruments.mockResolvedValue([{ id: 'instrument' }]);
  mocks.portfolio.mockResolvedValue({ ok: true, value: { summary: base(), holdings: [] } });
});

it.each([InvestmentsPage, PerformancePage])(
  'withholds misleading aggregate returns while retaining known figures (%#)',
  async (page) => {
    const html = renderToStaticMarkup(await page());
    expect(html).toContain('Needs every holding priced');
    expect(html).not.toContain('return:999%');
    expect(html).not.toContain('money:-4000000');
    expect(html).not.toContain('money:-3870000');
    expect(html).toContain('money:6000000');
    expect(html).toContain('money:10000000');
    expect(html).toContain('money:100000');
  },
);

it.each([InvestmentsPage, PerformancePage])(
  'shows legitimate zero-value/loss returns when every holding is priced (%#)',
  async (page) => {
    mocks.portfolio.mockResolvedValue({
      ok: true,
      value: { summary: { ...base(), unpricedInstruments: [], marketValue: money('0') }, holdings: [] },
    });
    const html = renderToStaticMarkup(await page());
    expect(html).toContain('return:999%');
    expect(html).toContain('money:-4000000');
    expect(html).not.toContain('Needs every holding priced');
  },
);

it('does not infer complete coverage from the cost percentage for a zero-cost unpriced holding', () => {
  expect(canShowPortfolioReturns(base())).toBe(false);
  expect(canShowPortfolioReturns({ ...base(), unpricedInstruments: [], unrealizedPnl: null })).toBe(false);
  const stale = {
    ...base(), unpricedInstruments: [],
    staleInstruments: [{ id: 'stale', symbol: 'OLD', name: 'Old' }],
  };
  expect(canShowPortfolioReturns(stale)).toBe(true);
});

it('keeps held inactive instruments visible and guards the aggregate footer', async () => {
  mocks.instruments.mockResolvedValue([]);
  mocks.portfolio.mockResolvedValue({
    ok: true,
    value: {
      summary: base(),
      holdings: [{
        accountId: 'account', instrument: { id: 'inactive' },
        quantity: { units: 1n }, baseMarketValue: money('600'),
      }],
    },
  });
  const html = renderToStaticMarkup(await InvestmentsPage());
  expect(html).toContain('Visible holding');
  expect(html).toContain('Portfolio totals');
  expect(html).not.toContain('Add an instrument to begin');
  expect(html).not.toContain('money:-4000000');
  expect(html).toContain('Invested capital includes all holdings');
  expect(html).toContain('excluded from market value and allocation');
});

it('keeps realised history visible after every instrument is closed and inactive', async () => {
  mocks.instruments.mockResolvedValue([]);
  const summary = {
    ...base(), investedCapital: money('0'), marketValue: money('0'),
    unrealizedPnl: money('0'), unpricedInstruments: [],
  };
  mocks.portfolio.mockResolvedValue({ ok: true, value: { summary, holdings: [] } });
  const html = renderToStaticMarkup(await InvestmentsPage());
  expect(html).not.toContain('Add an instrument to begin');
  expect(html).toContain('money:100000');
});

it('retains the setup state for a genuinely empty investment record', async () => {
  mocks.instruments.mockResolvedValue([]);
  mocks.portfolio.mockResolvedValue({
    ok: true,
    value: {
      summary: {
        ...base(), costDeployed: money('0'), realizedPnl: money('0'),
        dividends: money('0'), interest: money('0'), fees: money('0'), taxes: money('0'),
      },
      holdings: [],
    },
  });
  expect(renderToStaticMarkup(await InvestmentsPage())).toContain('Add an instrument to begin');
});
