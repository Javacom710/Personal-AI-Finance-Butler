/** Offline accounting only; contains no provider calls or scoring rules. */
export interface Usage { requests: number; tokens: number; }
export interface TimedUsage extends Usage { at: string; }
export interface QuotaLedger {
  day: string;
  requests: number;
  reservedTokens: number;
  events: { at: string; reservedTokens: number; }[];
  carry?: Usage;
  nativeBaseline?: TimedUsage;
}
const DAY_MS = 86_400_000;
const integer = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;

/** Each day's native usage excludes its imported carry: never carry carry twice. */
export function nativeUsage(ledger: QuotaLedger): TimedUsage[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ledger.day) || !integer(ledger.requests) || !integer(ledger.reservedTokens)) throw new Error('Invalid quota ledger.');
  const carry = ledger.carry ?? { requests: 0, tokens: 0 };
  if (!integer(carry.requests) || !integer(carry.tokens)) throw new Error('Invalid carried usage.');
  const events = ledger.events.map(e => ({ at: e.at, requests: 1, tokens: e.reservedTokens }));
  const baseline = ledger.nativeBaseline;
  const known = baseline ? [...events, baseline] : events;
  for (const e of known) if (!Number.isFinite(Date.parse(e.at)) || !integer(e.requests) || !integer(e.tokens)) throw new Error('Invalid timed usage.');
  const residual = {
    requests: ledger.requests - carry.requests - known.reduce((n, e) => n + e.requests, 0),
    tokens: ledger.reservedTokens - carry.tokens - known.reduce((n, e) => n + e.tokens, 0),
  };
  if (!integer(residual.requests) || !integer(residual.tokens)) throw new Error('Quota ledger totals disagree with entries.');
  // Legacy baseline or reserved-but-unanswered crash: its time is unknown.
  // Keep it through 24 hours after the END of its UTC day, never infer expiry.
  if (residual.requests || residual.tokens) known.push({ at: `${ledger.day}T23:59:59.999Z`, ...residual });
  return known;
}

export function recentUsage(ledgers: readonly QuotaLedger[], now: Date): Usage {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid quota window time.');
  const seen = new Set<string>();
  const result = { requests: 0, tokens: 0 };
  for (const ledger of ledgers) {
    if (seen.has(ledger.day)) throw new Error('Duplicate quota ledger day.');
    seen.add(ledger.day);
    for (const entry of nativeUsage(ledger)) {
      if (Date.parse(entry.at) + DAY_MS > now.getTime()) {
        result.requests += entry.requests;
        result.tokens += entry.tokens;
      }
    }
  }
  return result;
}

/** Seed/refresh previous-day carry, preserving today's own usage and reserves. */
export function prepareLedger(current: QuotaLedger, previous: readonly QuotaLedger[], now: Date): QuotaLedger {
  const day = now.toISOString().slice(0, 10);
  if (current.day !== day || previous.some(l => l.day >= day)) throw new Error('Quota ledger date does not match the window.');
  nativeUsage(current); // Refuse inconsistent totals before any mutation.
  const old = current.carry ?? { requests: 0, tokens: 0 };
  const base = current.nativeBaseline ?? { requests: 0, tokens: 0, at: now.toISOString() };
  const pending = {
    requests: current.requests - old.requests - base.requests - current.events.length,
    tokens: current.reservedTokens - old.tokens - base.tokens - current.events.reduce((n, e) => n + e.reservedTokens, 0),
  };
  // The caller holds the measurement lock: existing un-timed reservations all
  // predate this preflight. Seal that upper time once, without extending it on
  // repeated checks. A new crash reservation extends it conservatively.
  const nativeBaseline = pending.requests || pending.tokens ? {
    at: new Date(Math.max(Date.parse(base.at), now.getTime())).toISOString(),
    requests: base.requests + pending.requests,
    tokens: base.tokens + pending.tokens,
  } : current.nativeBaseline;
  const carry = recentUsage(previous, now);
  return { ...current, requests: current.requests - old.requests + carry.requests, reservedTokens: current.reservedTokens - old.tokens + carry.tokens, carry, ...(nativeBaseline ? { nativeBaseline } : {}) };
}
