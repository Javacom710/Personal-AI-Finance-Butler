import 'server-only';

/**
 * The AI layer's read capability â€” and the only thing `src/server/ai/**` is
 * allowed to hold ([ADR-33](../../../docs/DECISIONS.md#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import),
 * [ADR-35](../../../docs/DECISIONS.md#adr-35--ai-infrastructure-is-strictly-read-only-a-mutation-needs-a-separate-approved-proposal-workflow)).
 *
 * ## Why this module exists at all
 *
 * `AI-SYSTEM.md` Â§1 has always said the AI layer "holds only a `ReadCtx`". The
 * Phase 7 review (**F-1**) established that a `ReadCtx` is not a read-only
 * capability in any meaningful sense:
 *
 * - `readCtx.db` is a full drizzle handle. `.insert()`, `.update()`,
 *   `.delete()` and `.execute(sql\`update â€¦\`)` are all on it and all compile.
 * - `withWriteCtx(readCtx, â€¦)` used to compile clean, so any `ReadCtx` holder
 *   was one line from a `WriteCtx`.
 *
 * `AiReadCtx` is the correction. It is **not** a `ReadCtx` and is not
 * assignable to one:
 *
 * ```ts
 * withWriteCtx(ai, â€¦)   // TS2345 â€” no `beginTransaction`, no `db`, no `fx`
 * ai.db.insert(â€¦)       // TS2339 â€” there is no `db`
 * listAccounts(ai)      // TS2345 â€” a query needs a ReadCtx
 * ```
 *
 * All three are compile errors rather than lint findings, which is what makes
 * "the AI cannot write" a structural claim. `tests/unit/ai-write-boundary.test.ts`
 * asserts each one against the real `tsconfig.json`.
 *
 * ## What it carries, and what it deliberately does not
 *
 * The ambient facts a projection needs to render a figure â€” whose data this is,
 * what "today" means in the user's timezone, which currency the base figures are
 * in, how to format them. Nothing else. In particular **no `db`**: a capability
 * that carries a database handle is not read-only, it is merely
 * conventionally-read-only, and the review found exactly that convention being
 * relied on.
 *
 * ## How a Phase 7 tool handler will actually read
 *
 * Not from here, and not with this object. `internal.ts` holds the one bridge
 * from an `AiReadCtx` back to the bound `ReadCtx`, and it is **not** importable
 * from `src/server/ai/**` â€” enforced by the ESLint AI zone, by the source scan
 * in `tests/unit/ai-boundary-source-scan.test.ts`, and by the fact that the
 * binding lives in a module-private `WeakMap` that cannot be reached from a
 * value of type `AiReadCtx`.
 *
 * Phase 7 step 7.3 adds the enumerated, projected read functions to this module
 * â€” one per tool, each a thin projection over the application service the UI
 * already calls (`AI-SYSTEM.md` Â§8). Until then this module intentionally
 * exposes the capability and nothing else: **no AI infrastructure has been
 * implemented**, only the boundary it must later sit behind.
 */

import type { IsoDate } from '../../lib/date';
import type { CurrencyCode } from '../../lib/decimal/money';

/**
 * A read-only capability over one user's financial data.
 *
 * Opaque by design: it is a token that names *whose* data may be read and in
 * what terms, not a handle that can read anything by itself.
 */
export interface AiReadCtx {
  readonly userId: string;
  /** Injected, never `new Date()` â€” the same rule the engine follows. */
  readonly now: Date;
  /** "Today" in the user's timezone, not the server's. */
  readonly today: IsoDate;

  readonly base: CurrencyCode;
  readonly locale: string;
  readonly timezone: string;
  readonly fiscalYearStartMonth: number;
}

/**
 * The tool-facing read surface (Phase 7.3). Each function takes the capability
 * above and projects one application-service query — the same query the UI
 * calls, so the model and the screen cannot disagree.
 */
export * from './queries';
export type { ToolResult, ToolMeta, ToolError, MetricJson } from './projections';

