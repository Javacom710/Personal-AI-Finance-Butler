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
  price_stale_after_hours  integer NOT NULL DEFAULT 24,
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
- Credit cards and loans are accounts with a normally-negative balance. They are counted as liabilities in net worth by sign, not by a separate table. Standalone loans with amortisation schedules that are *not* transacted through use `liabilities` (§8).

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
  as_of         date NOT NULL,
  close         numeric(20,8) NOT NULL CHECK (close >= 0),
  currency_code char(3) NOT NULL REFERENCES currencies(code),
  source        text NOT NULL,
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

Staleness is computed, not stored: `now() - as_of > settings.price_stale_after_hours`. Storing a boolean would require a job to keep it honest.

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
  trade_date        date NOT NULL,
  settlement_date   date,
  quantity          numeric(28,8),          -- signed: + acquire, - dispose
  price             numeric(20,8),          -- per unit, instrument currency
  gross_amount      numeric(20,4),          -- |quantity| * price
  fees              numeric(20,4) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  taxes             numeric(20,4) NOT NULL DEFAULT 0 CHECK (taxes >= 0),
  net_amount        numeric(20,4) NOT NULL, -- signed cash effect on account_id
  currency_code     char(3) NOT NULL REFERENCES currencies(code),
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
  -- net_amount is cash actually received. income_total accrues GROSS; taxes are
  -- subtracted once, separately. Without this identity the two can disagree and
  -- total return silently double-subtracts the tax.
  CHECK (kind NOT IN ('dividend','interest')
         OR (net_amount > 0 AND gross_amount IS NOT NULL
             AND net_amount = gross_amount - fees - taxes)),
  CHECK (kind <> 'fee'  OR net_amount < 0),
  CHECK (kind <> 'tax'  OR net_amount < 0),
  CHECK (instrument_id IS NOT NULL OR kind IN ('fee','tax','interest'))
);
CREATE INDEX inv_txn_replay_idx ON investment_transactions
  (user_id, account_id, instrument_id, trade_date, created_at, id);
```

`inv_txn_replay_idx` is the ordering the lot engine replays in — deterministic, and total even when several transactions share a `trade_date`.

**Cash settlement — exactly one ledger per movement.** An investment transaction with `cash_settled = true` moves the brokerage account's cash **through the investment ledger only**. The application service does **not** also write a mirroring `transactions` row.

This is not a preference. `deriveBalance()` sums both ledgers unconditionally:
`opening_balance + Σ transaction_entries.amount + Σ investment_transactions.net_amount`.
A mirrored row would credit the account **twice** — a ₹500 dividend would raise the balance by ₹1,000.

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
  opened_on          date NOT NULL,
  original_quantity  numeric(28,8) NOT NULL CHECK (original_quantity > 0),
  remaining_quantity numeric(28,8) NOT NULL CHECK (remaining_quantity >= 0),
  cost_per_unit      numeric(20,8) NOT NULL CHECK (cost_per_unit >= 0),
  currency_code      char(3) NOT NULL REFERENCES currencies(code),
  fx_rate_to_base    numeric(20,10) NOT NULL,
  CHECK (remaining_quantity <= original_quantity)
);
CREATE INDEX tax_lots_pos_idx ON tax_lots (user_id, account_id, instrument_id, opened_on, id);

CREATE TABLE lot_disposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id             uuid NOT NULL REFERENCES tax_lots(id) ON DELETE CASCADE,
  closed_by_txn_id   uuid NOT NULL REFERENCES investment_transactions(id) ON DELETE CASCADE,
  closed_on          date NOT NULL,
  quantity           numeric(28,8) NOT NULL CHECK (quantity > 0),
  proceeds_per_unit  numeric(20,8) NOT NULL,
  cost_per_unit      numeric(20,8) NOT NULL,
  realized_pnl       numeric(20,4) NOT NULL,          -- instrument currency, net of allocated fees
  base_realized_pnl  numeric(20,4) NOT NULL,
  holding_days       integer NOT NULL CHECK (holding_days >= 0)
);

CREATE TABLE positions (
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instrument_id      uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  quantity           numeric(28,8) NOT NULL,
  cost_basis         numeric(20,4) NOT NULL,          -- instrument currency
  base_cost_basis    numeric(20,4) NOT NULL,
  realized_pnl       numeric(20,4) NOT NULL DEFAULT 0,
  income_total       numeric(20,4) NOT NULL DEFAULT 0,-- dividends + interest
  fees_total         numeric(20,4) NOT NULL DEFAULT 0,
  taxes_total        numeric(20,4) NOT NULL DEFAULT 0,
  first_trade_on     date,
  last_trade_on      date,
  ledger_version     bigint NOT NULL,
  computed_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id, instrument_id)
);
```

**Balances and positions are derived, never stored as truth.** There is no `accounts.current_balance` column; a balance is `opening_balance + Σ ledger entries`, computed on read. `tax_lots`, `lot_disposals`, and `positions` are a rebuildable cache of a ledger replay, not records — they can be deleted and re-derived at any moment without data loss.

`positions.avg_cost` is intentionally **not** stored — it is `cost_basis / quantity`, computed at read time with an explicit rounding scale.

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
  is_active     boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset_valuations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      uuid NOT NULL REFERENCES manual_assets(id) ON DELETE CASCADE,
  as_of         date NOT NULL,
  value         numeric(20,4) NOT NULL CHECK (value >= 0),
  currency_code char(3) NOT NULL REFERENCES currencies(code),
  source        text NOT NULL DEFAULT 'manual',
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, as_of)
);
```

Valuations are a time series, not a mutable field. Net worth on a past date uses the valuation in force on that date — the most recent `as_of <= date` — so historical net worth does not retroactively change when the user updates a property estimate today.

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
  linked_account_id uuid UNIQUE REFERENCES accounts(id) ON DELETE SET NULL,
  currency_code     char(3) NOT NULL REFERENCES currencies(code),
  principal_original numeric(20,4),
  interest_rate     numeric(12,8),          -- annual nominal, decimal fraction
  emi_amount        numeric(20,4),
  started_on        date,
  ends_on           date,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE liability_balances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liability_id  uuid NOT NULL REFERENCES liabilities(id) ON DELETE CASCADE,
  as_of         date NOT NULL,
  outstanding   numeric(20,4) NOT NULL CHECK (outstanding >= 0),
  currency_code char(3) NOT NULL REFERENCES currencies(code),
  source        text NOT NULL DEFAULT 'manual',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (liability_id, as_of)
);
```

**Double-count guard.** If `linked_account_id` is set, the liability's balance comes from the account's (negative) balance and `liability_balances` is ignored. The `UNIQUE` on `linked_account_id` prevents two liabilities claiming one account. The net-worth calculator asserts that each account of kind `credit_card`/`loan` is counted exactly once.

---

## 9. Net worth snapshots

```sql
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
| I-6 | `positions.cost_basis` = `Σ remaining_quantity × cost_per_unit` | integrity command |
| I-7 | No lot has `remaining_quantity < 0`; no position has `quantity < 0` unless the instrument permits shorting (it does not, at launch) | `CHECK` + engine |
| I-8 | Every `credit_card`/`loan` account is counted in net worth exactly once | net-worth calculator assertion |
| I-9 | `recurring_occurrences` has at most one row per `(rule_id, due_on)` | `UNIQUE` |
| I-10 | No `ai_proposals` row in status `applied` without a matching `audit_log` entry with `actor='ai_confirmed'` | integrity command |
| I-11 | `transaction_entries.base_amount` = `round(amount × fx_rate_to_base, 4)`, and the same for `investment_transactions.base_net_amount` | `CHECK` + integrity command |
| I-12 | For `dividend`/`interest`: `net_amount = gross_amount − fees − taxes`; `income_total` accrues **gross** and `taxes_total` accrues the withholding, so neither includes the other | `CHECK` + engine |
| I-14 | No `ai_proposals` row has produced more than one record — at most one `transactions` **or** `investment_transactions` row references it | partial `UNIQUE` index + CAS on apply |
| I-13 | No cash movement is recorded in both ledgers — an `investment_transactions` row with `cash_settled = true` has no mirroring `transactions` row for the same event | integrity command |

---

## 13. Migration policy

- Migrations are generated by `drizzle-kit generate`, reviewed as SQL, and committed. Never edited after being applied to production.
- Every migration that changes a financial column ships with a data-integrity check in the same PR.
- Destructive migrations (drop column, narrow a type) require a preceding backup verification and are split into expand → backfill → contract across separate deploys.
- `NUMERIC` scales are never reduced.
- Seed data (`currencies`, default categories) lives in `src/server/db/seed.ts` and is idempotent.
