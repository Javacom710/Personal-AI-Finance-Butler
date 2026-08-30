import 'server-only';

/**
 * Field projection â€” what a tool result actually contains
 * ([AI-SYSTEM.md Â§8](../../../docs/AI-SYSTEM.md),
 * [ADR-36](../../../docs/DECISIONS.md#adr-36--exact-values-cross-a-json-boundary-as-a-tagged-string-projection-never-as-a-json-number)).
 *
 * Two rules, and the second is the one that is easy to get wrong.
 *
 * **1. No figure crosses as a JSON number.** Every `Money`, `Rate`, `UnitPrice`
 * and `Quantity` goes through `src/lib/format/json-projection.ts`, which renders
 * exact digits at a stated scale. `Number()` appears nowhere.
 *
 * **2. Projection is explicit, per field.** Every function here names the fields
 * it emits. It never spreads a service result, because a service result carries
 * whatever the service happens to return â€” `notes`, internal ids, an
 * institution name â€” and a blind serializer would ship all of it to a third
 * party. Adding a field to a `*View` must not silently widen what leaves the
 * process; here it cannot, because the field has to be written down.
 *
 * That is also why `notes` is absent everywhere below. `SECURITY.md` Â§8's egress
 * inventory excludes it unless a tool's contract names it, and no tool's does.
 */

import {
  projectMoney,
  projectQuantity,
  projectPrice,
  projectRate,
  type MoneyJson,
  type PriceJson,
  type QuantityJson,
  type RateJson,
} from '../../lib/format/json-projection';
import type { Money } from '../../lib/decimal/money';
import type { Quantity } from '../../lib/decimal/quantity';
import type { UnitPrice } from '../../lib/decimal/price';
import type { Rate } from '../../lib/decimal/rate';
import type { Metric } from '../../lib/metric';

// ------------------------------------------------------------ primitives

export const money = (m: Money): MoneyJson => projectMoney(m);
export const rate = (r: Rate): RateJson => projectRate(r);
export const price = (p: UnitPrice): PriceJson => projectPrice(p);
export const quantity = (q: Quantity): QuantityJson => projectQuantity(q);

export const maybeMoney = (m: Money | null): MoneyJson | null => (m === null ? null : money(m));
export const maybeRate = (r: Rate | null): RateJson | null => (r === null ? null : rate(r));

/**
 * A `Metric<T>` â€” a value, or `null` **with a machine-readable reason**.
 *
 * The reason is the point. `FINANCIAL-DOMAIN.md` Â§10.3 requires missing data to
 * propagate as null and never as zero, and it must survive to the model so the
 * answer can say *"time-weighted return is unavailable: insufficient price
 * history"* rather than *"0%"*. A projection that dropped the reason would turn
 * a documented gap into a figure.
 */
export interface MetricJson<J> {
  readonly value: J | null;
  readonly unavailableReason: string | null;
}

export function metric<T, J>(m: Metric<T>, project: (value: T) => J): MetricJson<J> {
  return m.value === null
    ? { value: null, unavailableReason: m.reason ?? 'no_data' }
    : { value: project(m.value), unavailableReason: null };
}

export const metricMoney = (m: Metric<Money>): MetricJson<MoneyJson> => metric(m, money);
export const metricRate = (m: Metric<Rate>): MetricJson<RateJson> => metric(m, rate);

// ------------------------------------------------------------ result envelope

/**
 * The envelope every tool result crosses in.
 *
 * `meta` carries the honesty fields: whether rows were clipped, what the base
 * currency is, and what date the figures are as of. A model that receives a
 * clipped list without `truncated` will report a subset as a total.
 */
export interface ToolMeta {
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly totalMatching?: number;
  readonly currency: string;
  readonly asOf?: string;
  readonly from?: string;
  readonly to?: string;
}

export type ToolResult<T> =
  | { readonly ok: true; readonly data: T; readonly meta: ToolMeta }
  | { readonly ok: false; readonly error: ToolError };

export interface ToolError {
  readonly code: 'not_found' | 'invalid_input' | 'insufficient_data' | 'unavailable';
  readonly message: string;
}

export const toolOk = <T>(data: T, meta: ToolMeta): ToolResult<T> => ({ ok: true, data, meta });
export const toolErr = (code: ToolError['code'], message: string): ToolResult<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * A `DomainError`, projected.
 *
 * **The entity id is dropped.** `DomainError` carries one, and for a `settings`
 * error that id *is* the user id â€” so returning the raw error would leak an
 * identifier to a third party on a code path nobody would think to audit. This
 * function is the reason that cannot happen, and the adversarial security review
 * recorded it as the one residual to close here.
 *
 * `forbidden` is deliberately absent from the mapping: `requireOwnership`
 * returns `not_found` for an unauthorised id precisely so that the two are
 * indistinguishable, and re-introducing the distinction here would rebuild the
 * enumeration oracle the services avoid.
 */
export function projectDomainError(error: { code: string; message: string }): ToolError {
  switch (error.code) {
    case 'not_found':
      return { code: 'not_found', message: 'No such record.' };
    case 'validation_failed':
      return { code: 'invalid_input', message: 'The arguments were not valid for this tool.' };
    case 'insufficient_data':
      return { code: 'insufficient_data', message: 'Not enough data to compute this.' };
    default:
      return { code: 'unavailable', message: 'That information is unavailable.' };
  }
}

// ------------------------------------------------------------ caps

/** Row cap. A tool never returns an unbounded list (AI-SYSTEM.md Â§8). */
export const DEFAULT_ROW_CAP = 50;
export const MAX_ROW_CAP = 200;

/** Byte budget for one tool result, after projection. */
export const MAX_RESULT_BYTES = 150 * 1024;

export function clampRows(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_ROW_CAP;
  if (!Number.isFinite(requested) || requested < 1) return DEFAULT_ROW_CAP;
  return Math.min(Math.trunc(requested), MAX_ROW_CAP);
}

/**
 * Enforce the byte budget on a projected result.
 *
 * Clipping is visible: the returned `meta.truncated` is set and rows are
 * dropped from the end. Silent truncation would let a model report a subset as
 * a total, which is the failure this whole envelope exists to prevent.
 */
export function withinByteBudget<T>(rows: readonly T[]): { rows: readonly T[]; truncated: boolean } {
  let bytes = 0;
  const kept: T[] = [];
  for (const row of rows) {
    bytes += JSON.stringify(row).length;
    if (bytes > MAX_RESULT_BYTES) return { rows: kept, truncated: true };
    kept.push(row);
  }
  return { rows: kept, truncated: false };
}

