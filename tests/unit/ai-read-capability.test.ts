import { describe, expect, it } from 'vitest';

import { createAiReadCtx, withFinanceReads } from '@/server/ai-read/internal';
import type { AiReadCtx } from '@/server/ai-read';
import type { ReadCtx } from '@/server/services/_ctx';

/**
 * Invariant **I-52**, the behavioural half — *the read capability is a token,
 * not a handle* ([ADR-34](../../docs/DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths)).
 *
 * The source scan asserts the capability's *shape*: no `db`, no `fx`, no
 * `beginTransaction`, and a bridge that lives in a module-private `WeakMap`.
 * What it cannot assert is that the binding actually holds — that a value of
 * type `AiReadCtx` carries no route back to the context it was minted from, and
 * that one which was never minted here is refused rather than silently reading
 * someone else's data.
 *
 * That second property is the one worth a runtime test. `AiReadCtx` is a plain
 * interface, so a structurally identical object literal type-checks perfectly;
 * if the binding were a property rather than a `WeakMap`, forging one would be
 * trivial and the capability would be decoration.
 *
 * Note what this file does **not** demonstrate: it imports `internal.ts`, which
 * `src/server/ai/**` is forbidden to do. A test is not in the AI zone, and this
 * is the module's one legitimate consumer until Phase 7.3 adds the projected
 * read functions.
 */

/** A stand-in. Only the fields the capability copies are real. */
const readCtx = (userId: string): ReadCtx =>
  ({
    userId,
    now: new Date('2026-08-30T12:00:00Z'),
    today: '2026-08-30',
    base: 'INR',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    fiscalYearStartMonth: 4,
    fx: { rate: () => null },
    db: { marker: 'the handle the capability must not expose' },
  }) as unknown as ReadCtx;

describe('I-52 — the capability carries the ambient facts and nothing else', () => {
  const ai = createAiReadCtx(readCtx('user-1'));

  it('copies what a projection needs to render a figure', () => {
    expect(ai.userId).toBe('user-1');
    expect(ai.today).toBe('2026-08-30');
    expect(ai.base).toBe('INR');
    expect(ai.locale).toBe('en-IN');
    expect(ai.timezone).toBe('Asia/Kolkata');
    expect(ai.fiscalYearStartMonth).toBe(4);
  });

  it('exposes no database handle at runtime, not merely in the type', () => {
    // `ai.db` is already a compile error (I-50). This is the runtime half: the
    // property is genuinely absent, so a structured log, a spread, or an
    // `Object.keys` walk cannot surface the executor either.
    expect(Object.keys(ai).sort()).toEqual([
      'base',
      'fiscalYearStartMonth',
      'locale',
      'now',
      'timezone',
      'today',
      'userId',
    ]);
    expect(JSON.stringify(ai)).not.toContain('the handle the capability must not expose');
  });

  it('leaks nothing through the prototype chain', () => {
    for (const key of ['db', 'fx', 'beginTransaction', 'tx', 'audit']) {
      expect(key in (ai as unknown as Record<string, unknown>), key).toBe(false);
    }
  });
});

describe('I-52 — the binding is unforgeable', () => {
  it('resolves the bound context for a capability it minted', async () => {
    const ai = createAiReadCtx(readCtx('user-2'));
    const seen = await withFinanceReads(ai, async (read) => read.userId);
    expect(seen).toBe('user-2');
  });

  it('refuses a structurally identical object it did not mint', async () => {
    // The whole point. This literal satisfies `AiReadCtx` completely — it would
    // pass every type check — and it is still not in the map.
    const forged: AiReadCtx = {
      userId: 'user-2',
      now: new Date('2026-08-30T12:00:00Z'),
      today: '2026-08-30' as AiReadCtx['today'],
      base: 'INR' as AiReadCtx['base'],
      locale: 'en-IN',
      timezone: 'Asia/Kolkata',
      fiscalYearStartMonth: 4,
    };

    await expect(withFinanceReads(forged, async (read) => read.userId)).rejects.toThrow(
      /was not minted by createAiReadCtx/,
    );
  });

  it('refuses a copy of a real capability', async () => {
    // A spread, a structured clone, a round-trip through JSON — each produces a
    // value the type system accepts and the map does not know.
    const real = createAiReadCtx(readCtx('user-3'));
    await expect(withFinanceReads({ ...real }, async (r) => r.userId)).rejects.toThrow(
      /was not minted by createAiReadCtx/,
    );
  });

  it('keeps two capabilities bound to their own contexts', async () => {
    // The isolation that makes `userId` come from the session rather than from
    // anything the AI layer holds.
    const a = createAiReadCtx(readCtx('user-a'));
    const b = createAiReadCtx(readCtx('user-b'));
    expect(await withFinanceReads(a, async (r) => r.userId)).toBe('user-a');
    expect(await withFinanceReads(b, async (r) => r.userId)).toBe('user-b');
  });
});
