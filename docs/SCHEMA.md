# Database Schema

PostgreSQL 17. Written as DDL sketches — the authoritative definitions will be the Drizzle table files under `src/server/db/schema/`, from which `drizzle-kit` generates the checked-in migrations.

## Conventions

- Primary keys: `uuid` generated with `gen_random_uuid()` (`pgcrypto`). Exception: composite natural keys where they are genuinely natural (`fx_rates`, `instrument_prices`).
- Every user-owned table carries `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`. Single user today; this makes "delete everything" one statement and keeps the door open without building multi-tenancy ([CLAUDE.md §5](../CLAUDE.md)).
- Timestamps: `timestamptz`, `created_at`/`updated_at` on mutable tables, `DEFAULT now()`.
- Dates that are calendar dates (trade date, booking date, budget period) are `date`, not `timestamptz`. Timezone is a display concern.
- Enums are Postgres `ENUM` types, so a bad value cannot be inserted from any client.
- Numeric scales are fixed by [ADR-04](DECISIONS.md#adr-04--money-is-an-exact-scaled-integer-never-a-float):
  - money `numeric(20,4)`
  - quantity `numeric(28,8)`
  - unit price `numeric(20,8)`
  - FX rate `numeric(20,10)`
  - percentage/rate `numeric(12,8)` (stored as a decimal fraction: 0.0725 = 7.25%)
- `ON DELETE` is `RESTRICT` by default. Cascades are used only from `users` and from a header row to its own child rows (`transactions` → `transaction_entries`).

---

## 1. Identity and session

```sql
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  password_hash     text   NOT NULL,              -- argon2id
  totp_secret_enc   bytea,                        -- AES-256-GCM, key from APP_ENCRYPTION_KEY
  totp_enabled      boolean NOT NULL DEFAULT false,
  totp_recovery_hashes text[] NOT NULL DEFAULT '{}',
  last_totp_step    bigint,                       -- replay guard; see note below
  failed_attempts   integer NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,            -- SHA-256 of the cookie token
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ip            inet,
  user_agent    text
);
CREATE INDEX sessions_user_expires_idx ON sessions (user_id, expires_at);

CREATE TYPE auth_event_kind AS ENUM
  ('login_success','login_failure','totp_failure','logout','password_change','lockout','session_revoked');

CREATE TABLE auth_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  kind       auth_event_kind NOT NULL,
  ip         inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

The session token itself is never stored — only its SHA-256. A database read cannot mint a session.

**`users.last_totp_step`** (added in Phase 2 implementation). SECURITY.md §1 requires that "a used TOTP code is rejected for its remaining window". Because verification accepts ±1 step of drift, knowing only *when* a login succeeded does not identify which code was used — a code from the previous step is still inside the window and would replay successfully one step later. Recording the step the accepted code belonged to closes that, and persisting it means a process restart does not reopen the window. Covered by `tests/unit/auth-totp.test.ts` and `tests/integration/auth-flow.test.ts`.

---

## 2. Reference data

```sql
CREATE TABLE currencies (
  code        char(3) PRIMARY KEY,        -- ISO 4217
  minor_units smallint NOT NULL,          -- display scale: INR 2, JPY 0
  symbol      text NOT NULL,
  name        text NOT NULL
);

CREATE TABLE fx_rates (
  base_code  char(3) NOT NULL REFERENCES currencies(code),
  quote_code char(3) NOT NULL REFERENCES currencies(code),
  as_of      date NOT NULL,
  rate       numeric(20,10) NOT NULL CHECK (rate > 0),  -- 1 base = rate quote
  source     text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (base_code, quote_code, as_of)
);
```

FX lookup rule: exact date, else the most recent earlier date, else `missing`. Never interpolate forward.

---

## 3. Settings and cache versioning

```sql
CREATE TABLE settings (
  user_id                  uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_currency            char(3) NOT NULL REFERENCES currencies(code),
  locale                   text NOT NULL DEFAULT 'en-IN',
  timezone                 text NOT NULL DEFAULT 'Asia/Kolkata',
  fiscal_year_start_month  smallint NOT NULL DEFAULT 4 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  ai_enabled               boolean NOT NULL DEFAULT true,
  ai_daily_budget_micros   bigint  NOT NULL DEFAULT 200000000,   -- $200.000000 default cap
  -- Staleness thresholds. Two, because two kinds of instrument age differently
  -- (ADR-28). `_sessions` governs anything session-traded (equities, ETFs,
  -- mutual-fund NAV); `_hours` governs continuously-traded instruments only.
  price_stale_after_hours    integer NOT NULL DEFAULT 24 CHECK (price_stale_after_hours > 0),
  price_stale_after_sessions integer NOT NULL DEFAULT 3  CHECK (price_stale_after_sessions > 0),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_state (
  user_id                   uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  money_ledger_version      bigint NOT NULL DEFAULT 0,
  investment_ledger_version bigint NOT NULL DEFAULT 0
);
```

---

## 4. Money core

```sql
CREATE TYPE account_kind AS ENUM
  ('bank','cash','credit_card','wallet','brokerage','loan','other');

CREATE TABLE accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  kind             account_kind NOT NULL,
  institution      text,
  currency_code    char(3) NOT NULL REFERENCES currencies(code),
  opening_balance  numeric(20,4) NOT NULL DEFAULT 0,
  opening_date     date NOT NULL,
  credit_limit     numeric(20,4) CHECK (credit_limit IS NULL OR credit_limit >= 0),
  is_active        boolean NOT NULL DEFAULT true,
  display_order    integer NOT NULL DEFAULT 0,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name),
  CHECK (kind <> 'credit_card' OR credit_limit IS NOT NULL)
);
```

Notes:
- A brokerage/demat account is an `accounts` row with `kind='brokerage'`. Its cash balance and its investment transactions therefore live in one place — there is no parallel account system for investments.
- **`currency_code` is immutable once the account carries ledger rows.** Every `transaction_entries.amount` and every `investment_transactions.net_amount` on the account is denominated in it (OD-5, §6), so changing it would silently reinterpret the entire history. There is no supported operation to do so; the currency is chosen at creation.
- Credit cards and loans are accounts with a **normally**-negative balance. **Net worth classifies every account by the economic sign of its balance, never by `kind`** ([ADR-25](DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind)) — so a card carrying an overpayment is an **asset** at `+balance`, and an overdrawn bank account is a **liability** at `|balance|`. `kind` drives the display grouping and the expected sign; a row against its expected sign is flagged, never reclassified. Standalone loans with amortisation schedules that are *not* transacted through use `liabilities` (§8).
- **`opening_date` bounds the opening balance in every `asOf` calculation** ([ADR-26](DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates), [FINANCIAL-DOMAIN.md §3](FINANCIAL-DOMAIN.md#3-accounts)). An account opened in 2026 contributes nothing — not even its opening balance — to a figure as of 2020. `is_active` is a UI state and is read by **no** calculation (invariant I-26).

```sql
CREATE TYPE category_kind AS ENUM ('income','expense');

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        category_kind NOT NULL,
  parent_id   uuid REFERENCES categories(id) ON DELETE RESTRICT,
  is_archived boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, parent_id, name)
);
-- Depth is limited to 2 (parent + child), enforced in the engine.
-- A child MUST have the same `kind` as its parent (trigger or domain check).

CREATE TABLE tags (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Case-INSENSITIVE uniqueness: 'Travel' and 'travel' are one tag, not two.
-- A plain UNIQUE (user_id, name) would let both exist and silently split reports.
CREATE UNIQUE INDEX tags_user_name_ci_uniq ON tags (user_id, lower(name));
```

### 4.1 Transactions and entries ([ADR-05](DECISIONS.md#adr-05--entry-based-ledger-for-cash-movements))

```sql
CREATE TYPE transaction_kind AS ENUM ('income','expense','transfer');
CREATE TYPE record_source    AS ENUM ('manual','ai','recurring','import');

CREATE TABLE transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              transaction_kind NOT NULL,
  booked_on         date NOT NULL,
  description       text NOT NULL,
  category_id       uuid REFERENCES categories(id) ON DELETE RESTRICT,
  notes             text,
  source            record_source NOT NULL DEFAULT 'manual',
  recurring_rule_id uuid REFERENCES recurring_rules(id) ON DELETE SET NULL,
  ai_proposal_id    uuid REFERENCES ai_proposals(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'transfer' OR category_id IS NULL)
);
CREATE INDEX transactions_user_date_idx ON transactions (user_id, booked_on DESC, id DESC);
CREATE INDEX transactions_category_idx  ON transactions (user_id, category_id, booked_on);

CREATE TABLE transaction_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount          numeric(20,4) NOT NULL CHECK (amount <> 0),   -- signed, account currency
  currency_code   char(3) NOT NULL REFERENCES currencies(code),
  fx_rate_to_base numeric(20,10) NOT NULL CHECK (fx_rate_to_base > 0),
  base_amount     numeric(20,4) NOT NULL CHECK (base_amount <> 0),
  sort_order      smallint NOT NULL DEFAULT 0,
  -- base_amount is a STORED DERIVATION of amount x fx_rate_to_base (ADR-12).
  -- Without this CHECK it is a second money figure that can silently drift from
  -- the first. round() on numeric is immutable, so the database can enforce it.
  CONSTRAINT tx_entry_base_amount_consistent
    CHECK (base_amount = round(amount * fx_rate_to_base, 4))
);
CREATE INDEX tx_entries_account_idx ON transaction_entries (account_id);
CREATE INDEX tx_entries_txn_idx     ON transaction_entries (transaction_id);
```

**Sign convention.** `amount > 0` means money entered the account. `amount < 0` means money left it.

**Entry invariants** — enforced by a deferred constraint trigger `check_transaction_shape()` that runs at statement end, and mirrored in the engine (`assertEntryInvariants`) so violations surface as typed errors before they reach the database:

| `kind` | Entries | Signs | Category |
|---|---|---|---|
| `income` | exactly 1 | `amount > 0` | required, `kind='income'` |
| `expense` | exactly 1 | `amount < 0` | required, `kind='expense'` |
| `transfer` | exactly 2 | one `< 0`, one `> 0`, distinct accounts | must be NULL |

For a **same-currency transfer**, the two `base_amount` values MUST sum to exactly zero. For a **cross-currency transfer**, they will not; the residual is the realised FX difference and is reported as such in cash-flow analysis rather than silently absorbed. The trigger enforces `|Σ base_amount| = 0` when both entries share a currency.

```sql
CREATE TABLE transaction_tags (
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id         uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);
```

### 4.2 Budgets

```sql
CREATE TYPE budget_period AS ENUM ('monthly','quarterly','yearly');

CREATE TABLE budgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id   uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  period        budget_period NOT NULL,
  amount        numeric(20,4) NOT NULL CHECK (amount > 0),
  currency_code char(3) NOT NULL REFERENCES currencies(code),
  starts_on     date NOT NULL,
  ends_on       date,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on > starts_on)
);
-- One active budget per (category, period) at a time; enforced by a partial unique index
CREATE UNIQUE INDEX budgets_active_uniq
  ON budgets (user_id, category_id, period) WHERE is_active;
```

### 4.3 Recurring

```sql
CREATE TYPE recurring_kind      AS ENUM ('income','expense','transfer','investment');
CREATE TYPE occurrence_status   AS ENUM ('pending','posted','skipped');

CREATE TABLE recurring_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  kind            recurring_kind NOT NULL,
  template        jsonb NOT NULL,          -- validated by Zod: accounts, amount, category, instrument
  rrule           text NOT NULL,           -- RFC 5545 subset: FREQ, INTERVAL, BYMONTHDAY, BYDAY, COUNT, UNTIL
  starts_on       date NOT NULL,
  ends_on         date,
  auto_post       boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recurring_occurrences (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id                    uuid NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  due_on                     date NOT NULL,
  status                     occurrence_status NOT NULL DEFAULT 'pending',
  transaction_id             uuid REFERENCES transactions(id) ON DELETE SET NULL,
  investment_transaction_id  uuid REFERENCES investment_transactions(id) ON DELETE SET NULL,
  posted_at                  timestamptz,
  UNIQUE (rule_id, due_on)                 -- idempotency key, ADR-15
);
```

`UNIQUE (rule_id, due_on)` is the mechanism that makes double-posting impossible. See [ADR-15](DECISIONS.md#adr-15--idempotency-for-recurring-postings-via-a-materialised-occurrence-row).

**Forward references and migration order.** Two columns above point at tables that a *later* phase creates: `investment_transaction_id` → `investment_transactions` (Phase 4) and, in §4.1, `transactions.ai_proposal_id` → `ai_proposals` (Phase 7). The column is created nullable and **without** its foreign key in the earlier phase; the later phase's migration adds the constraint with `ALTER TABLE ... ADD CONSTRAINT`. Written inline above for readability, but a migration cannot reference a table that does not yet exist, and reordering the phases would put AI tables in Phase 3.

---

## 5. Instruments and prices

```sql
CREATE TYPE asset_class AS ENUM
  ('equity','mutual_fund','etf','bond','fixed_deposit','gold','crypto','cash_equivalent','other');
CREATE TYPE cost_basis_method AS ENUM ('fifo','average','specific_id');

CREATE TABLE instruments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol             text NOT NULL,
  exchange           text,                    -- NSE, BSE, NASDAQ, NULL for MF
  isin               text,
  name               text NOT NULL,
  asset_class        asset_class NOT NULL,
  currency_code      char(3) NOT NULL REFERENCES currencies(code),
  country            char(2),
  price_provider     text,                    -- key into the provider registry; NULL = manual
  provider_symbol    text,                    -- provider-specific identifier (e.g. AMFI scheme code)
  cost_basis_method  cost_basis_method NOT NULL DEFAULT 'fifo',   -- pluggable strategy; only 'fifo' implemented
  is_active          boolean NOT NULL DEFAULT true,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol, exchange)
);
CREATE INDEX instruments_isin_idx ON instruments (user_id, isin) WHERE isin IS NOT NULL;

CREATE TABLE instrument_prices (            -- historical daily closes
  instrument_id uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  as_of         date NOT NULL,              -- the TRADING DATE, in the market's timezone
  close         numeric(20,8) NOT NULL CHECK (close >= 0),
  currency_code char(3) NOT NULL REFERENCES currencies(code),
  source        text NOT NULL,              -- one value per series, pinned (ADR-30, I-35)
  provider_ref  text,                       -- the provider's own identifier at fetch time
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument_id, as_of)
);

CREATE TABLE instrument_quotes (            -- latest known price, one row per instrument
  instrument_id uuid PRIMARY KEY REFERENCES instruments(id) ON DELETE CASCADE,
  price         numeric(20,8) NOT NULL CHECK (price >= 0),
  currency_code char(3) NOT NULL REFERENCES currencies(code),
  as_of         timestamptz NOT NULL,       -- when the price was true
  source        text NOT NULL,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);
```

**Staleness is computed, not stored.** Storing a boolean would require a job to keep it honest, and a stale flag that is itself stale is worse than none.

It is **not** a wall-clock comparison. For a session-traded instrument — every equity, every ETF, every mutual-fund NAV — staleness is the number of completed trading sessions between the observation's trading date and the latest known session, against `settings.price_stale_after_sessions`. `settings.price_stale_after_hours` applies only to continuously-traded instruments. A 24-hour rule against an end-of-day close marks Friday's price stale on Saturday and keeps it stale all weekend, which is [ADR-28](DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours) and the reason there are two columns.

**The latest known session for an exchange is derived from this table** — `max(instrument_prices.as_of)` across its instruments. There is deliberately **no trading-calendar table**: the price series *is* the calendar, it cannot drift from the prices it describes, and it is automatically correct for every exchange a provider covers. A 10-calendar-day backstop catches a provider that has quietly stopped, which is the one case the derived calendar cannot see.

**`as_of` is the trading date, and the two tables carry it differently on purpose.** `instrument_prices.as_of` is a `date` — the session, in the market's timezone. `instrument_quotes.as_of` is a `timestamptz` and must be stamped at **the exchange's official close on that trading date** (15:30 IST for XNSE/XBOM, 16:00 ET for XNAS/XNYS) — not midnight, and never the fetch time. The candidates differ by up to ten hours, which is enough to move a staleness boundary. `fetched_at` records arrival and participates in no calculation: a price fetched two minutes ago can be three weeks old.

**One provider per series.** `source` takes one value for all rows of an instrument ([ADR-30](DECISIONS.md#adr-30--one-provider-per-instrument-price-series-the-only-price-fallback-is-manual), invariant **I-35**). Changing an instrument's provider purges and re-backfills; it never interleaves, because two vendors' closes differ and a blended series makes the splice indistinguishable from a real price move.

### 5.1 Corporate-action detections

```sql
CREATE TABLE corporate_action_detections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument_id   uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  kind            investment_kind NOT NULL CHECK (kind IN ('split','bonus')),
  ex_date         date NOT NULL,
  ratio_num       integer NOT NULL CHECK (ratio_num > 0),
  ratio_den       integer NOT NULL CHECK (ratio_den > 0),
  source          text NOT NULL,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  -- Set ONLY when the user accepts the detection through the ordinary validated
  -- service path. Never written by an adapter or a job (ADR-29, invariant I-40).
  resolved_txn_id uuid REFERENCES investment_transactions(id) ON DELETE SET NULL,
  dismissed_at    timestamptz,
  UNIQUE (instrument_id, kind, ex_date)
);
CREATE INDEX corporate_action_detections_open_idx
  ON corporate_action_detections (user_id, instrument_id)
  WHERE resolved_txn_id IS NULL AND dismissed_at IS NULL;
```

**This table is not part of the ledger, and that separation is the point.** A `split` or `bonus` row in `investment_transactions` drives `replay()` and therefore every lot, position and realised-P&L figure in the system. A market-data provider may never write one ([ADR-29](DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)) — the same rule, for the same reason, as the AI mutation rule.

`ratio_num` / `ratio_den` deliberately mirror `investment_transactions`' own columns so an accepted detection maps onto a proposed ledger row with no translation step where an inversion could creep in.

`UNIQUE (instrument_id, kind, ex_date)` is what makes re-detection idempotent: the same split found on ten consecutive weekly runs is one row.

**An open detection whose `ex_date` falls inside the holding period suppresses that instrument's market value** — `missing: 'unreconciled_corporate_action'`. It is never used to adjust a price or a quantity. Between an ex-date and the user recording the action, the provider's price is post-split while the ledger's quantity is not, and multiplying them produces a large, internally consistent, wrong number.

---

## 6. Investment ledger

```sql
CREATE TYPE investment_kind AS ENUM (
  'buy','sell','dividend','interest','fee','tax','bonus','split',
  'mf_purchase','mf_redemption','transfer_in','transfer_out'
);

CREATE TABLE investment_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  instrument_id     uuid REFERENCES instruments(id) ON DELETE RESTRICT,
  kind              investment_kind NOT NULL,
  trade_date        date NOT NULL,          -- the financial recognition AND cash date (ADR-22)
  settlement_date   date,                   -- informational metadata; controls nothing (ADR-22)
  quantity          numeric(28,8),          -- signed: + acquire, - dispose
  price             numeric(20,8),          -- per unit, INSTRUMENT currency
  gross_amount      numeric(20,4),          -- |quantity| * price, INSTRUMENT currency
  fees              numeric(20,4) NOT NULL DEFAULT 0 CHECK (fees >= 0),   -- instrument currency
  taxes             numeric(20,4) NOT NULL DEFAULT 0 CHECK (taxes >= 0),  -- instrument currency
  currency_code     char(3) NOT NULL REFERENCES currencies(code),  -- the INSTRUMENT's currency

  -- OD-5 and ADR-12: the cash effect is carried at THREE denominations, each a checked
  -- derivation of the one above it. Storing only the account-currency figure would make
  -- every per-kind identity below (net = gross - fees - taxes, etc.) inexpressible as a
  -- row-local CHECK, because its terms are in the instrument's currency; storing only
  -- the instrument-currency figure would make deriveBalance() add dollars to rupees.
  --
  --   net_amount_instrument   INSTRUMENT currency -- where the per-kind identities hold
  --   net_amount              ACCOUNT currency    -- what deriveBalance() sums
  --   base_net_amount         BASE currency       -- what aggregates run on
  --
  net_amount_instrument numeric(20,4) NOT NULL,

  -- 1 instrument-currency unit = this many account-currency units. Exactly 1 when the
  -- instrument and the account share a currency, which is the common case. Dated per
  -- FINANCIAL-DOMAIN.md §2 -- exact as_of, else most recent earlier, else reject.
  fx_rate_instrument_to_account numeric(20,10) NOT NULL CHECK (fx_rate_instrument_to_account > 0),
  net_amount        numeric(20,4) NOT NULL,
  CONSTRAINT inv_txn_account_amount_consistent
    CHECK (net_amount = round(net_amount_instrument * fx_rate_instrument_to_account, 4)),

  -- Converts the ACCOUNT currency to base.
  fx_rate_to_base   numeric(20,10) NOT NULL CHECK (fx_rate_to_base > 0),
  base_net_amount   numeric(20,4) NOT NULL,
  CONSTRAINT inv_txn_base_amount_consistent
    CHECK (base_net_amount = round(net_amount * fx_rate_to_base, 4)),
  ratio_num         integer,                -- split/bonus: new units per ratio_den old
  ratio_den         integer,
  cash_settled      boolean NOT NULL DEFAULT true,
  notes             text,
  source            record_source NOT NULL DEFAULT 'manual',
  ai_proposal_id    uuid REFERENCES ai_proposals(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CHECK (kind NOT IN ('buy','mf_purchase','transfer_in')  OR (quantity > 0 AND price IS NOT NULL)),
  CHECK (kind NOT IN ('sell','mf_redemption','transfer_out') OR (quantity < 0 AND price IS NOT NULL)),
  CHECK (kind NOT IN ('split','bonus')  OR (ratio_num > 0 AND ratio_den > 0 AND cash_settled = false)),
  -- Income kinds: gross_amount is the DECLARED amount, taxes is TDS withheld,
  -- net_amount_instrument is cash received in the instrument's currency. income_total
  -- accrues GROSS; taxes are subtracted once, separately. Without this identity the two
  -- can disagree and total return silently double-subtracts the tax.
  -- Every identity below is stated on net_amount_instrument, because gross_amount, fees
  -- and taxes are instrument-currency figures. Stating them on net_amount would equate
  -- an account-currency column with an instrument-currency expression -- false for every
  -- foreign-currency row, which would make a USD dividend into an INR account
  -- unrecordable.
  CHECK (kind NOT IN ('dividend','interest')
         OR (net_amount_instrument > 0 AND gross_amount IS NOT NULL
             AND net_amount_instrument = gross_amount - fees - taxes)),
  CHECK (kind <> 'fee'  OR net_amount_instrument < 0),
  CHECK (kind <> 'tax'  OR net_amount_instrument < 0),
  CHECK (instrument_id IS NOT NULL OR kind IN ('fee','tax','interest')),

  -- deriveBalance() sums net_amount UNCONDITIONALLY (FINANCIAL-DOMAIN.md §3). A row
  -- that settled no cash must therefore carry none, or it moves a balance that no
  -- cash ever moved. Both denominations, so the account-currency figure cannot be
  -- reintroduced by a non-zero rate. Invariant I-16.
  CONSTRAINT inv_txn_unsettled_moves_no_cash
    CHECK (cash_settled OR (net_amount = 0 AND net_amount_instrument = 0)),

  -- Trades: gross is a derivation of quantity x price, so it cannot disagree with them.
  -- round() on numeric is immutable, so the database can enforce it -- the same
  -- technique as transaction_entries.base_amount.
  CONSTRAINT inv_txn_gross_identity
    CHECK (kind NOT IN ('buy','sell','mf_purchase','mf_redemption','transfer_in','transfer_out')
           OR gross_amount = round(abs(quantity) * price, 4)),

  -- Cash identities per kind. dividend/interest already have one above; without these
  -- the buy and sell sides can silently disagree with their own components.
  CONSTRAINT inv_txn_buy_net_identity
    CHECK (kind NOT IN ('buy','mf_purchase')
           OR net_amount_instrument = -(gross_amount + fees + taxes)),
  CONSTRAINT inv_txn_sell_net_identity
    CHECK (kind NOT IN ('sell','mf_redemption')
           OR net_amount_instrument = gross_amount - fees - taxes),
  -- A transfer moves basis, not money. It carries no fees or taxes either: a fee on a
  -- transfer_in would contradict "no cash effect", and one on a transfer_out has no basis
  -- to capitalise into and no realised P&L to reduce, so it would vanish from total
  -- return. A demat transfer charge is a separate `fee` row.
  CONSTRAINT inv_txn_transfer_no_cash
    CHECK (kind NOT IN ('transfer_in','transfer_out')
           OR (net_amount = 0 AND net_amount_instrument = 0 AND fees = 0 AND taxes = 0)),

  -- A corporate action carries a ratio and nothing else. Permitting a quantity or a
  -- price on one invites an engine that reads it.
  CONSTRAINT inv_txn_corporate_action_shape
    CHECK (kind NOT IN ('split','bonus')
           OR (quantity IS NULL AND price IS NULL AND gross_amount IS NULL
               AND net_amount = 0 AND net_amount_instrument = 0
               AND fees = 0 AND taxes = 0)),
  CONSTRAINT inv_txn_ratio_only_on_corporate_actions
    CHECK (kind IN ('split','bonus') OR (ratio_num IS NULL AND ratio_den IS NULL))
);
CREATE INDEX inv_txn_replay_idx ON investment_transactions
  (user_id, account_id, instrument_id, trade_date, created_at, id);

-- The ledger list view: every investment transaction, newest first. Mirrors
-- transactions_user_date_idx on the money side; without it the page sorts on every load.
CREATE INDEX inv_txn_user_date_idx ON investment_transactions
  (user_id, trade_date DESC, id DESC);
```

**`trade_date` is the only date any calculation reads** ([ADR-22](DECISIONS.md#adr-22--financial-recognition-is-trade-dated-settlement_date-is-informational-metadata), resolving OD-6). It is the financial recognition date and the cash date: `deriveBalance()` bounds on it, `replay()` orders by it, and every historical or `asOf` figure is derived from it. `settlement_date` is a recorded factual attribute — typically transcribed from a contract note — and controls no recognition, no balance, no ledger dating and no replay. The engine's `ReplayTxn` has no settlement field at all, so replay cannot read it even by accident. No settlement-date-based cash movement exists, and settlement-aware accounting logic is out of scope for the current architecture.

`inv_txn_replay_idx` is the ordering the lot engine replays in — deterministic, and total even when several transactions share a `trade_date`. The engine sorts by `(trade_date, kind_rank, created_at, id)`, where `kind_rank` places corporate actions **after** same-day trades; it is derived from `kind` in the engine rather than stored, so the index is unchanged ([INVESTMENT-DOMAIN.md §3](INVESTMENT-DOMAIN.md#ordering)).

**Three denominations per row (OD-5, ADR-12).** `price`, `gross_amount`, `fees` and `taxes` are in the **instrument's** currency (`currency_code`). The cash effect is then carried three times, each a `CHECK`ed derivation of the one before it:

```
net_amount_instrument   instrument currency   the per-kind identities hold HERE
        × fx_rate_instrument_to_account
net_amount              account currency      deriveBalance() sums THIS
        × fx_rate_to_base
base_net_amount         base currency         aggregates run on THIS
```

This is the same "store both plus the rate, and `CHECK` the derivation" pattern as `transaction_entries` ([ADR-12](DECISIONS.md#adr-12--base-currency-with-dated-fx-stored-alongside-native-amounts)), extended by one link because an investment transaction genuinely straddles two currencies.

**Both intermediate columns are load-bearing, and dropping either breaks something:**

- Without `net_amount_instrument`, every per-kind identity above — `net_amount = gross_amount − fees − taxes` and its siblings — would equate an **account-currency** column with an **instrument-currency** expression. That is false for every row where the two differ, so a USD dividend paid into an INR brokerage account would be **rejected by the database**: unrecordable, despite being the exact case [INVESTMENT-DOMAIN.md §2.1](INVESTMENT-DOMAIN.md#21-two-currencies-per-transaction-and-which-one-net_amount-is-in) and golden scenario **G3** are built around.
- Without `net_amount`, `deriveBalance()` would add dollars to rupees — silently, with no constraint able to detect it.

`fx_rate_instrument_to_account` is exactly `1` when the instrument and the account share a currency, which is the common case; the chain then collapses and `net_amount_instrument = net_amount`.

**An account's `currency_code` is immutable once it carries ledger rows** — there is no supported operation to change it, because doing so would silently reinterpret every historical `net_amount`.

Note the deliberate asymmetry with `transaction_entries.currency_code`, which denominates *that* table's `amount` and is the account's currency. Here `currency_code` is the **instrument's**. The two tables answer different questions, and conflating them is the mistake this paragraph exists to prevent.

**Cash settlement — exactly one ledger per movement.** An investment transaction with `cash_settled = true` moves the brokerage account's cash **through the investment ledger only**. The application service does **not** also write a mirroring `transactions` row.

This is not a preference. `deriveBalance()` sums both ledgers unconditionally:
`opening_balance + Σ transaction_entries.amount + Σ investment_transactions.net_amount`.
A mirrored row would credit the account **twice** — a ₹500 dividend would raise the balance by ₹1,000.

Two consequences of that sum being unconditional, both enforced rather than assumed:

- Every term must be in the **account's** currency, which is why `net_amount` is denominated there and not in the instrument's (OD-5, §6 above).
- A row that settled no cash must carry `net_amount = 0`, enforced by `CHECK` (I-16) — otherwise `cash_settled = false` would still move the balance.

The rule, therefore: **every rupee of movement is recorded in exactly one ledger.**
- Instrument you track → `investment_transactions`. Its buys, sells, dividends, interest, fees and taxes all live there.
- Something not modelled as an instrument → an ordinary `transactions` row with category `Investment income`.
- **Never both.** Reporting may union the two ledgers ([FINANCIAL-DOMAIN.md §8](FINANCIAL-DOMAIN.md#8-cash-flow-calculations)) — that is a read, not a second row. `deriveBalance()` in `src/server/domain/ledger/` is the single implementation of that sum — balances are always derived, never stored.

### 6.1 Derived investment state ([ADR-06](DECISIONS.md#adr-06--holdings-are-derived-cached-and-rebuildable))

```sql
CREATE TABLE tax_lots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instrument_id      uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  opened_by_txn_id   uuid NOT NULL REFERENCES investment_transactions(id) ON DELETE CASCADE,

  opened_on          date NOT NULL,   -- when this lot row came into being
  -- The ORIGINAL acquisition. transfer_in carries it forward from the source lot, so
  -- moving shares between your own demat accounts does not reset a long-term holding
  -- to short-term. holding_days is measured from here, never from opened_on.
  acquired_on        date NOT NULL,

  original_quantity  numeric(28,8) NOT NULL CHECK (original_quantity > 0),
  remaining_quantity numeric(28,8) NOT NULL CHECK (remaining_quantity >= 0),

  -- Money is stored EXACTLY; cost_per_unit is DERIVED (cost_total / original_quantity
  -- at PRICE_SCALE) and is deliberately not a column -- the same reasoning that keeps
  -- positions.avg_cost out of the schema. Holding the total exactly and deriving the
  -- rate is what makes I-6 an exact equality instead of one with a tolerance, and what
  -- lets a split touch no money at all (INVESTMENT-DOMAIN.md §4).
  cost_total         numeric(20,4) NOT NULL CHECK (cost_total >= 0),
  remaining_cost     numeric(20,4) NOT NULL CHECK (remaining_cost >= 0),

  currency_code      char(3) NOT NULL REFERENCES currencies(code),
  -- The rate on acquired_on. Never revalued -- that is what makes a currency movement
  -- a gain rather than a silent restatement of history (INVESTMENT-DOMAIN.md §6.4).
  fx_rate_to_base    numeric(20,10) NOT NULL CHECK (fx_rate_to_base > 0),

  CHECK (remaining_quantity <= original_quantity),
  CHECK (remaining_cost     <= cost_total),
  -- Units and basis drain together. Makes "a lot with units but no basis" -- and the
  -- reverse -- unrepresentable rather than merely unlikely. Invariant I-19.
  CHECK ((remaining_quantity = 0) = (remaining_cost = 0))
);
CREATE INDEX tax_lots_pos_idx ON tax_lots (user_id, account_id, instrument_id, opened_on, id);

CREATE TABLE lot_disposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalised from tax_lots so realised P&L over a period is one indexed scan
  -- rather than a join. Cascades from users via tax_lots as well; both paths are safe.
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lot_id             uuid NOT NULL REFERENCES tax_lots(id) ON DELETE CASCADE,
  closed_by_txn_id   uuid NOT NULL REFERENCES investment_transactions(id) ON DELETE CASCADE,
  closed_on          date NOT NULL,

  quantity           numeric(28,8) NOT NULL CHECK (quantity > 0),
  -- Money, not per-unit rates: proceeds are ALLOCATED across lots and cost is consumed
  -- exactly, so these sum back without residue. proceeds_per_unit and cost_per_unit are
  -- derived for display. transfer_out sets proceeds = cost_consumed, so realised P&L is
  -- zero by construction rather than by a subtraction that happens to cancel.
  proceeds           numeric(20,4) NOT NULL,
  cost_consumed      numeric(20,4) NOT NULL CHECK (cost_consumed >= 0),
  realized_pnl       numeric(20,4) NOT NULL,          -- instrument currency

  -- The rate on closed_on. With tax_lots.fx_rate_to_base (the acquisition rate) this
  -- is what lets the base-currency P&L be split into price and currency components.
  fx_rate_to_base    numeric(20,10) NOT NULL CHECK (fx_rate_to_base > 0),
  base_realized_pnl  numeric(20,4) NOT NULL,
  -- Stored; base_price_component is DERIVED as base_realized_pnl - base_fx_component,
  -- so the two can never fail to sum to the total. Invariant I-18.
  base_fx_component  numeric(20,4) NOT NULL,

  holding_days       integer NOT NULL CHECK (holding_days >= 0),   -- from lot.acquired_on

  -- Realised P&L is a DERIVATION of two figures on this row, so the database can
  -- enforce it rather than trusting the engine. Invariant I-15.
  CONSTRAINT lot_disposal_pnl_identity
    CHECK (realized_pnl = proceeds - cost_consumed)
);
-- Realised P&L over a period: PortfolioSummary, the net-worth change bridge, and the
-- disposals UI all filter on closed_on. Without this they seq-scan.
CREATE INDEX lot_disposals_user_closed_idx ON lot_disposals (user_id, closed_on DESC, id DESC);
CREATE INDEX lot_disposals_lot_idx         ON lot_disposals (lot_id);
CREATE INDEX lot_disposals_txn_idx         ON lot_disposals (closed_by_txn_id);

CREATE TABLE positions (
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instrument_id      uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  quantity           numeric(28,8) NOT NULL,
  cost_basis         numeric(20,4) NOT NULL,          -- instrument currency; = Σ remaining_cost
  base_cost_basis    numeric(20,4) NOT NULL,          -- Σ (remaining_cost × lot.fx_rate_to_base)
  realized_pnl       numeric(20,4) NOT NULL DEFAULT 0,
  -- GROSS declared dividends + interest (I-12). fees_total and taxes_total hold ONLY
  -- instrument-attributed amounts: trade fees are already inside cost_basis (buys) or
  -- realized_pnl (sells), and account-level rows with instrument_id IS NULL have no
  -- position to accrue to and are summed at portfolio level instead.
  income_total       numeric(20,4) NOT NULL DEFAULT 0,
  fees_total         numeric(20,4) NOT NULL DEFAULT 0,
  taxes_total        numeric(20,4) NOT NULL DEFAULT 0,
  first_trade_on     date,
  last_trade_on      date,
  -- A PROVENANCE stamp, not a staleness check. Nothing compares it against
  -- user_state.investment_ledger_version to decide whether to rebuild: that counter is
  -- global per user, so after any trade every position but the rebuilt one would look
  -- stale forever. Correctness comes from the rebuild sharing the mutation's
  -- transaction (ARCHITECTURE.md §6).
  ledger_version     bigint NOT NULL,
  computed_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id, instrument_id)
);
-- "Which accounts hold X", and allocation grouped by instrument. The primary key
-- leads with account_id, so neither is served by it.
CREATE INDEX positions_instrument_idx ON positions (user_id, instrument_id);
```

**Balances and positions are derived, never stored as truth.** There is no `accounts.current_balance` column; a balance is `opening_balance + Σ ledger entries`, computed on read. `tax_lots`, `lot_disposals`, and `positions` are a rebuildable cache of a ledger replay, not records — they can be deleted and re-derived at any moment without data loss.

`positions.avg_cost` is intentionally **not** stored — it is `cost_basis / quantity`, computed at read time with an explicit rounding scale. `tax_lots.cost_per_unit` is omitted for the identical reason: a derived money figure that is stored is a second figure free to drift from the first.

---

## 7. Manual assets

```sql
CREATE TYPE manual_asset_kind AS ENUM
  ('property','vehicle','gold_physical','collectible','receivable','other');

CREATE TABLE manual_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          manual_asset_kind NOT NULL,
  currency_code char(3) NOT NULL REFERENCES currencies(code),
  acquired_on   date,
  acquisition_cost numeric(20,4),
  -- Point-in-time net worth needs a DATE, not a flag: an asset disposed today must still
  -- appear in last year's figure (FINANCIAL-DOMAIN.md §9.3). `is_active` is derived from
  -- this for the UI and is never an input to a calculation (ADR-26, invariant I-26).
  disposed_on   date,
  is_active     boolean NOT NULL DEFAULT true,
  CHECK (disposed_on IS NULL OR acquired_on IS NULL OR disposed_on >= acquired_on),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Parity with `accounts`. Two rows named "Flat" are almost always one duplicate entry,
  -- and a duplicate manual asset is a silent double count the schema CAN prevent.
  UNIQUE (user_id, name)
);
-- Every as-of query filters on disposal.
CREATE INDEX manual_assets_user_disposed_idx ON manual_assets (user_id, disposed_on);

CREATE TABLE asset_valuations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SCHEMA.md's own convention, and the precedent lot_disposals.user_id set: without it
  -- every as-of query joins through the parent merely to establish ownership.
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id      uuid NOT NULL REFERENCES manual_assets(id) ON DELETE CASCADE,
  as_of         date NOT NULL,
  value         numeric(20,4) NOT NULL CHECK (value >= 0),
  -- NO currency_code. A valuation is denominated in its ASSET's currency; storing it
  -- again would be a second figure free to disagree with the first, and no cross-table
  -- CHECK could stop it. The same reasoning that keeps positions.avg_cost out of §6.1.
  source        text NOT NULL DEFAULT 'manual',
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, as_of)
);
-- valuationInForce is "the greatest as_of <= T". This is the index that makes it a seek.
CREATE INDEX asset_valuations_lookup_idx ON asset_valuations (user_id, asset_id, as_of DESC);
```

Valuations are a time series, not a mutable field. Net worth on a past date uses the valuation in force on that date — the most recent `as_of <= date` — so historical net worth does not retroactively change when the user updates a property estimate today.

**There is no `UPDATE` path.** Revaluing inserts; the service exposes no update, and correcting a wrong valuation is a delete plus an insert that the audit log records in full.

**An eligible asset with no valuation in force at `asOf` is excluded and named, never counted as zero** ([FINANCIAL-DOMAIN.md §9.3](FINANCIAL-DOMAIN.md#93-calculation)).

---

## 8. Liabilities

```sql
CREATE TYPE liability_kind AS ENUM
  ('home_loan','auto_loan','personal_loan','student_loan','credit_card','other');

CREATE TABLE liabilities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  kind              liability_kind NOT NULL,
  -- RESTRICT, not SET NULL: nulling this silently converts a TRANSACTED liability into a
  -- SCHEDULED one with no balance rows, which then contributes zero and the debt vanishes.
  -- Accounts carrying ledger history already cannot be deleted, so this costs nothing.
  linked_account_id uuid UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  currency_code     char(3) NOT NULL REFERENCES currencies(code),
  principal_original numeric(20,4),
  -- DESCRIPTIVE ONLY. Nothing computes an amortisation schedule from these, and the UI
  -- must not imply one (FINANCIAL-DOMAIN.md §9.4).
  interest_rate     numeric(12,8),          -- annual nominal, decimal fraction
  emi_amount        numeric(20,4),
  started_on        date,
  ends_on           date,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX liabilities_user_active_idx ON liabilities (user_id, is_active);

CREATE TABLE liability_balances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  liability_id  uuid NOT NULL REFERENCES liabilities(id) ON DELETE CASCADE,
  as_of         date NOT NULL,
  outstanding   numeric(20,4) NOT NULL CHECK (outstanding >= 0),
  -- NO currency_code, for the same reason as asset_valuations: it is the LIABILITY's
  -- currency, and a stored copy is a second figure free to disagree.
  source        text NOT NULL DEFAULT 'manual',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (liability_id, as_of)
);
CREATE INDEX liability_balances_lookup_idx ON liability_balances (user_id, liability_id, as_of DESC);
```

**Double-count guard.** If `linked_account_id` is set the liability contributes **nothing** to net worth — the account contributes, by sign — and `liability_balances` is ignored entirely. The `UNIQUE` on `linked_account_id` prevents two liabilities claiming one account (invariant **I-8**).

**The linked account must be of kind `credit_card` or `loan`** (invariant **I-27**). A liability linked to a `bank` account would contribute nothing *while the account contributed as an asset*, so the debt would disappear. This is a cross-table rule, so it cannot be a `CHECK`: it is a service guard plus an integrity check.

**Closing a scheduled liability inserts a terminal `liability_balances` row with `outstanding = 0`**, dated on the closing date, *before* `is_active = false` (invariant **I-28**). Under a date-driven rule the flag changes nothing, so without the zero row the last non-zero balance stays in force forever.

---

## 9. Net worth snapshots — **Phase 6, not built at launch**

**Net worth is derived on demand. Nothing about it is stored** ([ADR-24](DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)). A month-end series is five set-based queries followed by one pure fold, so the *N*-point-computations problem this table exists to solve does not arise; and as sketched below its stamp covers neither `asset_valuations`, nor `liability_balances`, nor `instrument_quotes`, nor `fx_rates`, so a row could go stale behind two matching versions.

The sketch is retained because Phase 6 may introduce it if a **market-valued** series — which joins a price per instrument per date — misses [ARCHITECTURE.md §9](ARCHITECTURE.md#9-performance-targets). Four rules apply if it does:

1. The **current** figure is always derived; a snapshot is never read for today.
2. A historical point is read **only** when every stamped input version matches; otherwise it is derived and the row rewritten.
3. The stamp set is completed first — `user_state.valuation_version`, bumped by every write to `manual_assets`, `asset_valuations`, `liabilities` and `liability_balances`, plus whatever covers prices and FX. **That column is not added in Phase 5**: nothing there reads it.
4. `verify:integrity` asserts **snapshot = derivation** for a sample of dates, making the cache a checked artefact rather than a trusted one.

```sql
-- PHASE 6. Not created by the Phase 5 migration.
CREATE TABLE net_worth_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  as_of             date NOT NULL,
  base_currency     char(3) NOT NULL REFERENCES currencies(code),
  total_assets      numeric(20,4) NOT NULL,
  total_liabilities numeric(20,4) NOT NULL,
  net_worth         numeric(20,4) NOT NULL,
  breakdown         jsonb NOT NULL,        -- { cash, bank, investments{byClass}, manualAssets, ... }
  price_coverage    numeric(5,4) NOT NULL, -- 1.0000 = every holding priced
  money_ledger_version      bigint NOT NULL,
  investment_ledger_version bigint NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, as_of)
);
```

---

## 10. AI

```sql
CREATE TYPE ai_role          AS ENUM ('user','assistant');
CREATE TYPE proposal_kind    AS ENUM
  ('transaction','investment_transaction','account','category','budget','recurring_rule');
CREATE TYPE proposal_status  AS ENUM ('pending','applied','rejected','expired','invalid');

CREATE TABLE ai_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE ai_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role             ai_role NOT NULL,
  content          jsonb NOT NULL,        -- provider-agnostic message shape
  task             text,                  -- 'answerFinanceQuestion', 'analyzePortfolio', ...
  tier             smallint CHECK (tier BETWEEN 1 AND 5),
  model            text,                  -- the model that actually served it
  fallback_depth   smallint NOT NULL DEFAULT 0,
  finish_reason    text,                  -- stop | length | tool_calls | content_filter | error
  prompt_tokens     integer,
  completion_tokens integer,
  cost_micros      bigint,                -- from config/pricing.ts; NULL when rates unverified
  latency_ms       integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_model_idx ON ai_messages (model, created_at DESC);

-- One row per attempt in a fallback chain. The fallback system is ours to
-- implement (ADR-09), so it must be observable: which model was tried, why it
-- failed, and how deep the chain went before something served the request.
CREATE TYPE ai_failure_class AS ENUM
  ('unavailable','rate_limited','timeout','invalid_schema','tool_call_failed',
   'content_filter','transport','none');

CREATE TABLE ai_model_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     uuid NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  attempt_index  smallint NOT NULL,
  model          text NOT NULL,
  tier           smallint NOT NULL,
  outcome        ai_failure_class NOT NULL,   -- 'none' = this attempt succeeded
  http_status    integer,
  error_detail   text,
  latency_ms     integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, attempt_index)
);
CREATE INDEX ai_attempts_health_idx ON ai_model_attempts (model, outcome, created_at DESC);

CREATE TABLE ai_tool_calls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  tool_name   text NOT NULL,
  input       jsonb NOT NULL,
  row_count   integer,
  bytes_out   integer,
  duration_ms integer,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id   uuid REFERENCES ai_conversations(id) ON DELETE SET NULL,
  kind              proposal_kind NOT NULL,
  raw_payload       jsonb NOT NULL,       -- exactly what the model produced
  normalized        jsonb,                -- post-Zod, post-entity-resolution
  status            proposal_status NOT NULL DEFAULT 'pending',
  validation_errors jsonb,
  applied_entity_id uuid,
  applied_at        timestamptz,
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_proposals_pending_idx
  ON ai_proposals (user_id, created_at DESC) WHERE status = 'pending';

-- A proposal may produce AT MOST ONE record. Belt-and-braces alongside the
-- compare-and-swap in applyProposal(): even if that guard were removed, a
-- double-confirm cannot create a second transaction from one proposal.
CREATE UNIQUE INDEX transactions_ai_proposal_uniq
  ON transactions (ai_proposal_id) WHERE ai_proposal_id IS NOT NULL;
CREATE UNIQUE INDEX inv_txn_ai_proposal_uniq
  ON investment_transactions (ai_proposal_id) WHERE ai_proposal_id IS NOT NULL;

CREATE TABLE ai_usage_daily (
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day               date NOT NULL,
  tier              smallint NOT NULL,
  model             text NOT NULL,
  requests          integer NOT NULL DEFAULT 0,
  failures          integer NOT NULL DEFAULT 0,
  fallback_requests integer NOT NULL DEFAULT 0,
  prompt_tokens     bigint  NOT NULL DEFAULT 0,
  completion_tokens bigint  NOT NULL DEFAULT 0,
  cost_micros       bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, tier, model)
);

-- Phase 8 evaluation results. Stored rather than kept only as report files so
-- Settings → AI can show which model is serving each tier and on what evidence,
-- and so CI can fail when a production-routed model has no recent measurement.
CREATE TABLE ai_model_evaluations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model          text NOT NULL,
  tier           smallint NOT NULL,
  eval_version   integer NOT NULL,        -- bumped when the task set changes
  suite          text NOT NULL,           -- parse | classify | tool-select | grounding | ...
  cases_total    integer NOT NULL,
  cases_passed   integer NOT NULL,
  score          numeric(5,4) NOT NULL,   -- 0..1
  p50_latency_ms integer,
  p95_latency_ms integer,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- failing cases, per-field breakdown
  run_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model, eval_version, suite, run_at)
);
CREATE INDEX ai_model_eval_latest_idx ON ai_model_evaluations (model, suite, run_at DESC);
```

`raw_payload` is kept alongside `normalized` so a rejected or mis-resolved proposal can be inspected without re-running the model.

`ai_model_evaluations` is **not** user-owned — it describes models, not finances, and carries no `user_id`. It therefore survives a user deletion and is excluded from data export.

---

## 11. Audit and jobs

```sql
CREATE TYPE audit_actor AS ENUM ('user','system','ai_confirmed');

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  actor       audit_actor NOT NULL,
  action      text NOT NULL,             -- 'transaction.create', 'account.update', ...
  entity_type text NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  request_id  text
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, at DESC);
```

The audit log is append-only. No `UPDATE`/`DELETE` grant on it for the application role; retention is handled by an explicit maintenance job, not by the app.

```sql
CREATE TYPE job_status AS ENUM ('pending','running','done','failed');

CREATE TABLE jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,             -- 'recurring.post', 'prices.refresh', 'networth.snapshot', 'backup.verify'
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_after   timestamptz NOT NULL DEFAULT now(),
  status      job_status NOT NULL DEFAULT 'pending',
  attempts    integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error  text,
  locked_at   timestamptz,
  locked_by   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX jobs_claim_idx ON jobs (status, run_after) WHERE status = 'pending';
```

Claim query: `SELECT ... FROM jobs WHERE status='pending' AND run_after <= now() ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1`.

---

## 12. Invariants summary

These are checked by database constraints where possible, by the engine always, and by an `npm run verify:integrity` command that can be run against production data.

| # | Invariant | Enforced by |
|---|---|---|
| I-1 | Transaction entry counts and signs match `kind` | trigger + domain |
| I-2 | Transfers carry no category | `CHECK` + domain |
| I-3 | Same-currency transfer entries sum to zero in base currency | trigger + domain |
| I-4 | Account balance = opening + Σ entries + Σ investment net amounts | integrity command |
| I-5 | `Σ tax_lots.remaining_quantity` = `positions.quantity` for every position | integrity command |
| I-6 | `positions.cost_basis` = `Σ tax_lots.remaining_cost` — an **exact** equality, no tolerance | integrity command |
| I-7 | No lot has `remaining_quantity < 0`; no position has `quantity < 0` unless the instrument permits shorting (it does not, at launch) | `CHECK` + engine |
| I-8 | No account is counted twice in net worth: a `liabilities` row with `linked_account_id` set contributes **zero** (the account contributes, by sign), and no two rows claim one account | `UNIQUE (linked_account_id)` + calculator assertion + integrity command |
| I-9 | `recurring_occurrences` has at most one row per `(rule_id, due_on)` | `UNIQUE` |
| I-10 | No `ai_proposals` row in status `applied` without a matching `audit_log` entry with `actor='ai_confirmed'` | integrity command |
| I-11 | `transaction_entries.base_amount` = `round(amount × fx_rate_to_base, 4)`; and on `investment_transactions` the full chain: `net_amount` = `round(net_amount_instrument × fx_rate_instrument_to_account, 4)` and `base_net_amount` = `round(net_amount × fx_rate_to_base, 4)` | `CHECK` + integrity command |
| I-12 | For `dividend`/`interest`: `net_amount_instrument = gross_amount − fees − taxes` — stated in the **instrument's** currency, where all four terms live; `income_total` accrues **gross** and `taxes_total` accrues the withholding, so neither includes the other | `CHECK` + engine |
| I-14 | No `ai_proposals` row has produced more than one record — at most one `transactions` **or** `investment_transactions` row references it | partial `UNIQUE` index + CAS on apply |
| I-13 | No cash movement is recorded in both ledgers — an `investment_transactions` row with `cash_settled = true` has no mirroring `transactions` row for the same event | integrity command |
| I-15 | `lot_disposals.realized_pnl` = `proceeds − cost_consumed` | `CHECK` |
| I-16 | `cash_settled = false` ⟹ `net_amount = 0` **and** `net_amount_instrument = 0` — an unsettled row moves no cash at any denomination | `CHECK` |
| I-17 | `positions.base_cost_basis` = `Σ (remaining_cost × lot.fx_rate_to_base)`, summed per lot | integrity command |
| I-18 | `base_realized_pnl` = `base_price_component + base_fx_component`, where the price component is derived as the difference | engine + integrity command |
| I-19 | Per lot, `(remaining_quantity = 0) = (remaining_cost = 0)` — units and basis drain together | `CHECK` |
| I-20 | Per lot, `Σ lot_disposals.cost_consumed + remaining_cost` = `cost_total` | integrity command |

### Net worth (Phase 5)

Added by the Phase 5 design review. Every one maps to a rule in [FINANCIAL-DOMAIN.md §9](FINANCIAL-DOMAIN.md#9-net-worth) and to a named test in [TESTING.md](TESTING.md).

| # | Invariant | Enforced by |
|---|---|---|
| I-21 | The contributions map is **injective** — no `SourceKey` is inserted twice | engine throws + unit test |
| I-22 | `netWorth` = `Σ contributions` = `assets − liabilities`, by two independent paths, **exactly** | engine + integrity command |
| I-23 | A lot contributes at `T` **iff `opened_on <= T`** — never `acquired_on`, which a `transfer_in` carries back and which would double-count the transfer period | engine + integration test |
| I-24 | `investmentCostBasisAsOf(today)` = `Σ positions.base_cost_basis`, **exactly** — the as-of derivation and the Phase 4 cache agree | integrity command + property |
| I-25 | A `buy` leaves `netWorth(T)` unchanged for every `T ≥ trade_date`; a `sell` changes it by exactly the realised P&L; a `dividend` by exactly the net received; a `split`/`bonus` by exactly zero | property test |
| I-26 | **No calculation reads `is_active`** on `accounts`, `manual_assets`, `liabilities` or `instruments` | **source scan** (as TESTING.md §7 does for model identifiers) |
| I-27 | `liabilities.linked_account_id` references an account of kind `credit_card` or `loan` | service guard + integrity command |
| I-28 | Every inactive **scheduled** liability has a terminal `liability_balances` row with `outstanding = 0` | service rule + integrity command |
| I-29 | The last point of the net-worth series equals `netWorthAsOf(today)`, byte-identical | integration test |
| I-30 | The change bridge closes: `ΔnetWorth − Σ lines` = **exactly 0** for single-currency data, and within one base unit with FX | golden scenarios |
| I-31 | An account contributes at `T` **iff `opening_date <= T`** — including its opening balance; and its side is chosen by the **sign** of its balance, never by `kind` | engine + integration test |
| I-32 | Every row read by a net-worth query belongs to the session user; `networth.ts` exports no function taking a `WriteCtx` | `user_id` columns + integration test + type-level test |
| I-33 | `instrument_quotes.currency_code = instruments.currency_code` — a quote in another currency is a provider error, never a conversion opportunity | engine (`classifyQuote`) + `verify:integrity` |
| I-34 | `instrument_prices.currency_code = instruments.currency_code` for every row | `verify:integrity` |
| I-35 | Every `instrument_prices` row for one instrument shares one `source` — no blended series ([ADR-30](DECISIONS.md#adr-30--one-provider-per-instrument-price-series-the-only-price-fallback-is-manual)) | `verify:integrity` |
| I-36 | `instrument_quotes.as_of >= max(instrument_prices.as_of)` for the same instrument — the latest quote is never older than the newest stored close | age-guarded upsert + `verify:integrity` |
| I-37 | No `instrument_prices` row is dated after the latest known session for its exchange | `verify:integrity` |
| I-38 | Under `basis: 'market'`, every open position **either** contributes a priced value **or** appears in `excluded[]` with a reason — exhaustive and disjoint. *(Reported `skipped` until Phase 6.11 implements `market`; live from then)* | engine + integration test |
| I-39 | A market-basis figure never substitutes a cost figure for any holding — no cost fallback inside a market total ([ADR-23](DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)). *(Reported `skipped` until Phase 6.11; live from then)* | engine + type-level test |
| I-40 | `corporate_action_detections.resolved_txn_id` is written only by the validated service path; no adapter or job writes it, and no provider creates an `investment_transactions` row ([ADR-29](DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)) | source scan + integration test |
| I-41 | A net-worth figure carries exactly **one** declared basis, and no total mixes `cost` and `market` ([ADR-23](DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)) | engine + type-level test |
| ~~I-42~~ | **Dissolved 2026-08-21, not renumbered.** The Phase 6.11 draft proposed it, then found **I-38** and **I-39** already say exactly the same two things — a position is priced or excluded, and cost is never substituted inside a market total. Two numbers for one rule is how a rule set starts disagreeing with itself. The number is retired rather than reused so no reference silently re-points | — |
| I-43 | No source key contributes twice under either basis; a cost-and-market pair for one position **throws** rather than summing | `ContributionMap.add()` + unit test |
| I-44 | A stale price contributes and is reported as stale; it never becomes `current`, and it is never replaced by cost ([ADR-28](DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours)) | engine + integration test |
| I-45 | Every excluded component carries a machine-readable reason; "unpriced" is never reported without one | engine + integration test |
| I-46 | `quantityHeldOn(i, T)` applies **every** corporate-action ratio in `(trade_date, T]` — a plain `Σ quantity` is wrong after any split or bonus | property test across split / bonus / reverse split |
| I-47 | A historical figure reads no current-state cache — not `positions`, not `is_active`, on any table ([ADR-26](DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates)) | source scan, extending I-26 |
| I-48 | The cost-to-market restatement closes: `NW(cost) − removed + fxRebasis + priceEffect = NW(market)`, **exactly** for single-currency data ([ADR-31](DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time)) | golden scenario |
| I-49 | Market value preserves provider precision to scale 8, rounding **only** at `valueOf` and `mulRate` — never through `Number()` | unit test + `numeric(20,8)` on `instrument_prices` |

### Explicit non-invariants

Stated because each is intuitive, will be assumed, and is **false**. `verify:integrity` must not assert them.

| Relation | Why it fails |
|---|---|
| `Σ lot_disposals.quantity + tax_lots.remaining_quantity` = `tax_lots.original_quantity` | A `split` or `bonus` rescales a partially disposed lot's quantities; already-settled disposal rows are historical records and are not rewritten. The **money** form (I-20) holds unconditionally and is the one to check. |
| `positions.ledger_version` = `user_state.investment_ledger_version` | The counter is global per user; after any trade every position but the one just rebuilt carries a lower value. It is a provenance stamp, not a staleness check ([ARCHITECTURE.md §6](ARCHITECTURE.md#6-cache-invalidation)). |
| `positions.quantity > 0` ⟺ the position contributes to net worth at `T` | `positions` answers a question about **today**. A position sold to zero today still had value at earlier dates, and a lot opened after `T` contributes nothing at `T`. |
| `Σ liability_balances.outstanding` over active liabilities = total liabilities | **Transacted** liabilities take their figure from the linked account and contribute zero through `liability_balances`. |
| `assets(T)` = `Σ balance(a,T)` over accounts with a positive balance | True only before any manual asset or investment exists. |
| `netWorth` is monotone in `T` | Obviously false. Stated so that no series-smoothing "fix" is ever attempted. |
| A `net_worth_snapshots` row whose two ledger versions match is current | Prices, FX rates, valuations and liability balances are covered by neither counter — which is one of the two reasons snapshots are deferred ([ADR-24](DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)). |

---

## 13. Migration policy

- Migrations are generated by `drizzle-kit generate`, reviewed as SQL, and committed. Never edited after being applied to production.
- Every migration that changes a financial column ships with a data-integrity check in the same PR.
- Destructive migrations (drop column, narrow a type) require a preceding backup verification and are split into expand → backfill → contract across separate deploys.
- `NUMERIC` scales are never reduced.
- Seed data (`currencies`, default categories) lives in `src/server/db/seed.ts` and is idempotent.
