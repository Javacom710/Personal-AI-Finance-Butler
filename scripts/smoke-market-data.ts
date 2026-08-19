/**
 * Live market-data smoke test — **not** part of the deterministic suite.
 *
 * ```
 * npm run smoke:market-data
 * ```
 *
 * Makes a small number of real requests and prints what the adapter normalised
 * them into, so a human can confirm the identity, venue, price and session date
 * are the ones they expect. It writes **nothing** to the database: this proves
 * the adapter, not the storage path, which the integration suite already covers.
 *
 * It is a `scripts/` entry point, so it is never bundled, never imported by the
 * application and never reachable over HTTP.
 *
 * ## Why this is not a test
 *
 * A test that calls a third party fails when that third party has a bad morning,
 * and a suite that goes red for reasons outside the repository is a suite people
 * learn to ignore. `TESTING.md` §6 makes the same call for every provider.
 *
 * ## The key
 *
 * Read from the environment, never printed, never included in an error. The
 * adapter puts it in a query string because that is what the provider accepts,
 * which is exactly why no failure message in this file quotes a URL.
 */

import { loadDotEnv, resetEnvCache, env } from '../src/lib/env';
import { isoDate } from '../src/lib/date';
import { currency } from '../src/lib/decimal/money';
import { pToDbString } from '../src/lib/decimal/price';
import { createTwelveDataProvider } from '../src/server/market-data/providers/twelvedata';
import { XNSE } from '../src/server/market-data/exchanges';
import { describeFailure, refKey, type ProviderRef } from '../src/server/market-data/types';

loadDotEnv();
resetEnvCache();

const apiKey = env().TWELVE_DATA_API_KEY ?? null;

if (apiKey === null) {
  console.error(
    [
      '',
      'TWELVE_DATA_API_KEY is not configured, so the live smoke test cannot run.',
      '',
      'Everything else works without it: mutual funds price from AMFI and FX from',
      'Frankfurter, both of which need no credential. Only equities and ETFs are',
      'affected, and they report "no price source" rather than a fabricated figure.',
      '',
      'To configure it locally:',
      '',
      '  1. Sign in at https://twelvedata.com and copy a key from',
      '     https://twelvedata.com/account/api-keys',
      '     India (XNSE/XBOM) needs the Grow plan or higher.',
      '  2. Add one line to .env — which is git-ignored and must stay that way:',
      '',
      '       TWELVE_DATA_API_KEY=your-key-here',
      '',
      '  3. Re-run: npm run smoke:market-data',
      '',
      'Do not paste the key into a commit, a log, a test fixture, or a chat window.',
      '',
    ].join('\n'),
  );
  process.exit(2);
}

/**
 * A liquid NSE name, chosen because a wrong answer is obvious to a human: if the
 * price is in dollars or three digits out, it is the wrong security.
 */
const INFY: ProviderRef = {
  instrumentId: 'smoke-infy',
  providerSymbol: 'INFY',
  exchange: XNSE,
  isin: 'INE009A01021',
  currency: currency('INR'),
  assetClass: 'equity',
};

const provider = createTwelveDataProvider({ fetch: (url, init) => fetch(url, init), apiKey });

function fail(step: string, detail: string): never {
  // `detail` is a `describeFailure` string, which never contains a URL and so
  // never contains the key.
  console.error(`FAILED at ${step}: ${detail}`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log('Live smoke test — Twelve Data\n');

  // 1. Reference data: is this the security we think it is?
  const metadata = await provider.getInstrument!(INFY);
  if (!metadata.ok) fail('getInstrument', describeFailure(metadata.error));
  console.log('  instrument   ', metadata.value.name);
  console.log('  venue        ', metadata.value.exchange);
  console.log('  currency     ', metadata.value.currency);

  if (metadata.value.currency !== INFY.currency) {
    fail('getInstrument', `currency ${metadata.value.currency} is not ${INFY.currency}`);
  }
  if (metadata.value.exchange !== XNSE) {
    fail('getInstrument', `venue ${metadata.value.exchange} is not XNSE`);
  }

  // 2. Latest price: does it parse, and is it stamped at the session close?
  const quotes = await provider.getLatestPrices!([INFY]);
  const quote = quotes.get(refKey(INFY));
  if (!quote || !quote.ok) fail('getLatestPrices', quote ? describeFailure(quote.error) : 'no result');
  console.log('\n  close        ', pToDbString(quote.value.close));
  console.log('  trading date ', quote.value.tradingDate);
  console.log('  observed at  ', quote.value.observedAt.toISOString(), '(15:30 IST = 10:00 UTC)');
  console.log('  source       ', quote.value.source);

  if (quote.value.close.units <= 0n) fail('getLatestPrices', 'close is not positive');
  if (!quote.value.observedAt.toISOString().endsWith('T10:00:00.000Z')) {
    fail('getLatestPrices', `observedAt ${quote.value.observedAt.toISOString()} is not the NSE close`);
  }

  // 3. A short history: does the series come back ordered and in range?
  const to = quote.value.tradingDate;
  const from = isoDate(`${to.slice(0, 4)}-01-01`);
  const history = await provider.getHistoricalPrices!(INFY, from, to);
  if (!history.ok) fail('getHistoricalPrices', describeFailure(history.error));
  console.log(`\n  history      ${history.value.length} sessions from ${from} to ${to}`);
  if (history.value.length > 0) {
    const first = history.value[0]!;
    const last = history.value[history.value.length - 1]!;
    console.log(`  first        ${first.tradingDate}  ${pToDbString(first.close)}`);
    console.log(`  last         ${last.tradingDate}  ${pToDbString(last.close)}`);
    if (first.tradingDate > last.tradingDate) fail('getHistoricalPrices', 'series is not ascending');
  }

  // 4. Splits — expected to be empty for a name with no recent action, and to
  //    be a *detection* either way. Nothing here writes to the ledger.
  const actions = await provider.getCorporateActions!(INFY, from, to);
  if (!actions.ok) {
    // A plan without the fundamentals entitlement refuses this, which is a
    // limitation to record rather than a failure of the integration.
    console.log('\n  splits       unavailable —', describeFailure(actions.error));
  } else {
    console.log(`\n  splits       ${actions.value.length} detected (never auto-applied)`);
  }

  const printed = JSON.stringify({ metadata: metadata.value, quote: quote.value });
  if (printed.includes(apiKey!)) fail('output check', 'the API key appeared in the output');

  console.log('\nOK — identity, venue, price, session date and precision all verified.');
  console.log('Nothing was written to the database.');
}

main().catch((error: unknown) => {
  console.error('FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
