/**
 * JSON projection for exact financial values — the boundary where a domain
 * value becomes something an external consumer can read
 * ([ADR-36](../../../docs/DECISIONS.md#adr-36--exact-values-cross-a-json-boundary-as-a-tagged-string-projection-never-as-a-json-number)).
 *
 * ## The problem this exists to solve
 *
 * `Money`, `Quantity`, `UnitPrice` and `Rate` are all `bigint` at a declared
 * scale (ADR-04). `JSON.stringify` **throws** on every one of them, by
 * specification, and no domain type defines `toJSON`. So nothing the financial
 * engine returns can currently cross a JSON boundary at all, and the first
 * person who needs one has exactly two obvious options, both wrong:
 *
 * | Tempting | Why not |
 * |---|---|
 * | `Number(m.minor)` | loses precision above 2^53 — the float path ADR-04 exists to keep out of financial code. `₹1,00,00,00,00,000.0001` is not representable. **Never.** |
 * | `m.minor.toString()` | lossless, but prints raw scaled units. A price of ₹1,121 becomes `"112100000000"`, which no reader recognises and everyone will compare against a real price. |
 *
 * A third, subtler wrong answer is a bare decimal string — `"1121.00000000"`
 * with nothing attached. It reads correctly and carries no way to know what it
 * *is*: whether that is rupees or dollars, a price or a quantity, scale 8 or
 * scale 10. A consumer that has to infer the denomination from a field name will
 * eventually infer it wrong.
 *
 * ## The projection
 *
 * Every exact value crosses as a **tagged object** carrying the digits, the
 * scale they are written at, and — for money — the currency:
 *
 * ```json
 * { "kind": "money",    "amount": "1250.5000",    "currency": "INR", "scale": 4  }
 * { "kind": "quantity", "units":  "10.50000000",  "scale": 8 }
 * { "kind": "price",    "units":  "1121.00000000","scale": 8 }
 * { "kind": "rate",     "value":  "0.0725000000", "scale": 10 }
 * ```
 *
 * Four properties, each load-bearing:
 *
 * 1. **Exact.** The digit string comes from `formatFixed`, which is bigint
 *    arithmetic end to end. No `Number` appears anywhere in the path, so the
 *    projection of a value and the value itself carry the same information —
 *    {@link projectMoney} round-trips through `Money.fromDbString`.
 * 2. **Self-describing.** `kind` distinguishes a price from a quantity, which a
 *    structural walker cannot do — `UnitPrice` and `Quantity` are the *same
 *    shape* (`{ units: bigint }`) and are told apart only by where they came
 *    from. That is why projection is per-value and explicit rather than a
 *    recursive walk over whatever a service happened to return.
 * 3. **Stable.** The field names and `kind` tags are the schema. They do not
 *    change with locale, display settings, or the currency's minor units — this
 *    is not formatting, and `formatMoney` is still the only thing that renders
 *    for a human.
 * 4. **Deterministic.** The same value projects to the same object every time.
 *    Key order is fixed by construction order, so `JSON.stringify` of a
 *    projection is byte-stable and can be compared, hashed, or fixture-tested.
 *
 * ## What this module is not
 *
 * It is **not** a serializer for service results, and it must not become one.
 * `src/lib/format/diagnostic-json.ts` already walks an arbitrary object graph
 * for diagnostics; a walker is the right shape there and the wrong shape here,
 * because it emits every enumerable property of whatever it is handed. A tool
 * result must be a *projection* — an explicit, per-field choice of what leaves
 * the server — and a blind walker is the exact opposite of that.
 *
 * The financial types stay ignorant of all this. Nothing in `src/lib/decimal/`
 * imports this module, no domain type gains a `toJSON`, and the direction of the
 * dependency is one way: the boundary knows about the domain, never the reverse.
 */

import { formatFixed } from '../decimal/scaled';
import { MONEY_SCALE, type Money } from '../decimal/money';
import { PRICE_SCALE, type UnitPrice } from '../decimal/price';
import { QTY_SCALE, type Quantity } from '../decimal/quantity';
import { RATE_SCALE, type Rate } from '../decimal/rate';

export interface MoneyJson {
  readonly kind: 'money';
  /** Exact decimal digits at `scale`. Never a JSON number. */
  readonly amount: string;
  readonly currency: string;
  readonly scale: number;
}

export interface QuantityJson {
  readonly kind: 'quantity';
  readonly units: string;
  readonly scale: number;
}

export interface PriceJson {
  readonly kind: 'price';
  readonly units: string;
  readonly scale: number;
}

export interface RateJson {
  readonly kind: 'rate';
  readonly value: string;
  readonly scale: number;
}

/** Any exact value in its projected form. */
export type ExactJson = MoneyJson | QuantityJson | PriceJson | RateJson;

/**
 * `₹1,250.50` → `{ kind: 'money', amount: '1250.5000', currency: 'INR', scale: 4 }`.
 *
 * The currency travels **with** the amount rather than beside it in a sibling
 * field, so a figure cannot be read against the wrong denomination by a consumer
 * that projected the two separately.
 */
export function projectMoney(m: Money): MoneyJson {
  return {
    kind: 'money',
    amount: formatFixed(m.minor, MONEY_SCALE),
    currency: m.currency,
    scale: MONEY_SCALE,
  };
}

export function projectQuantity(q: Quantity): QuantityJson {
  return { kind: 'quantity', units: formatFixed(q.units, QTY_SCALE), scale: QTY_SCALE };
}

/**
 * Distinct from {@link projectQuantity} despite the identical input shape.
 *
 * `UnitPrice` and `Quantity` are both `{ units: bigint }` at scale 8, so no
 * amount of inspection tells them apart — only the call site knows. Projecting
 * them through separate functions is what puts that knowledge into the output,
 * and it is the reason this module cannot be replaced by a structural walker.
 */
export function projectPrice(p: UnitPrice): PriceJson {
  return { kind: 'price', units: formatFixed(p.units, PRICE_SCALE), scale: PRICE_SCALE };
}

export function projectRate(r: Rate): RateJson {
  return { kind: 'rate', value: formatFixed(r.value, RATE_SCALE), scale: RATE_SCALE };
}

/** A value that may be absent, and the machine-readable reason when it is. */
export type MaybeJson<T> = T | null;

/**
 * Project an optional exact value.
 *
 * `null` stays `null`. A missing figure must never project to zero — the
 * distinction between "nothing" and "nought" is the whole of
 * `FINANCIAL-DOMAIN.md` §10.3, and it is at a boundary like this one that it is
 * most easily lost.
 */
export function projectOptional<T, J>(value: T | null, project: (v: T) => J): MaybeJson<J> {
  return value === null ? null : project(value);
}
