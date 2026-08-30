import 'server-only';

/**
 * The bridge between an {@link AiReadCtx} and the `ReadCtx` it was minted from.
 *
 * **`src/server/ai/**` must never import this file.** It is the one place where
 * an AI-facing capability becomes a database-backed one, and it lives outside
 * the AI zone precisely so that the AI zone's import ban can be absolute rather
 * than carved-out. Three mechanisms say so, none of which is a comment:
 *
 * 1. the ESLint AI zone forbids `@/server/ai-read/internal` and every relative
 *    spelling of it (`eslint.config.mjs`);
 * 2. `tests/unit/ai-boundary-source-scan.test.ts` scans the AI zone's source for
 *    it, catching the dynamic `import()` that ESLint's rule does not check at
 *    all;
 * 3. the binding is a module-private `WeakMap`. There is no property on an
 *    `AiReadCtx` to discover, no prototype to walk, and no cast that recovers
 *    the `ReadCtx` — a forged object simply is not in the map.
 *
 * The composition root (a route handler or server action, in Phase 7) mints the
 * capability with {@link createAiReadCtx} and hands the *capability* to the AI
 * layer. The projected read functions that Phase 7 adds to `./index.ts` are the
 * only callers of {@link withFinanceReads}.
 */

import type { ReadCtx } from '../services/_ctx';
import type { AiReadCtx } from './index';

/**
 * Capability → the context it was minted from.
 *
 * A `WeakMap` rather than a private field: a field can be found by anything
 * holding the object, and `Object.keys`, spread and structured logging would all
 * expose the database handle that the capability exists to withhold.
 */
const bound = new WeakMap<AiReadCtx, ReadCtx>();

/**
 * Mint a read-only AI capability from a request's read context.
 *
 * Called by the composition root, never by AI code — it takes a `ReadCtx`, and
 * the AI zone has no way to obtain one.
 */
export function createAiReadCtx(read: ReadCtx): AiReadCtx {
  // Frozen, like every value in `src/lib/decimal`. `readonly` is erased at
  // runtime, and the adversarial review found the consequence: `ai.userId` could
  // be overwritten. It could never redirect a *read* — `withFinanceReads` keys
  // the WeakMap on object identity, so the bound context is whatever it was
  // minted with — but it could make the capability's own fields disagree with
  // the context behind it, and a projection rendering `ai.userId` would then
  // label one user's figures with another's name.
  const ai: AiReadCtx = Object.freeze({
    userId: read.userId,
    now: read.now,
    today: read.today,
    base: read.base,
    locale: read.locale,
    timezone: read.timezone,
    fiscalYearStartMonth: read.fiscalYearStartMonth,
  });
  bound.set(ai, read);
  return ai;
}

/**
 * Run one application-service **query** on behalf of a capability.
 *
 * `fn` receives the bound `ReadCtx`. Note what this does *not* enable: the
 * `ReadCtx` still cannot reach `withWriteCtx`, because that now requires a
 * `RequestCtx` and only `createReadCtx` grants one (ADR-33). So even a caller
 * who reached this function could not escalate to a write — it is a read
 * capability all the way down, not merely a read *convention*.
 */
export async function withFinanceReads<T>(
  ai: AiReadCtx,
  fn: (read: ReadCtx) => Promise<T>,
): Promise<T> {
  const read = bound.get(ai);
  if (!read) {
    // A capability that was not minted here — a literal, a structured clone, a
    // deserialised copy. Failing loudly beats reading someone else's data.
    throw new Error(
      'withFinanceReads: this AiReadCtx was not minted by createAiReadCtx and has no bound read context.',
    );
  }
  return fn(read);
}
