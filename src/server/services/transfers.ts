import 'server-only';

/**
 * Transfers (FINANCIAL-DOMAIN.md §4).
 *
 * A transfer moves money; it is **never** income or expense. That is enforced
 * structurally rather than by discipline:
 *
 * - `kind='transfer'` carries no category — a `CHECK` forbids one — so category
 *   reporting has nothing to leak.
 * - Income, expense, savings and budget queries filter `kind IN ('income',
 *   'expense')`, and `totalsByGroup` in the engine takes the kind as a required
 *   argument so a tag-grouped report cannot forget it.
 * - Both base amounts of a **same-currency** transfer sum to exactly zero
 *   (I-3, checked by the engine and again by the database at COMMIT), so even an
 *   unfiltered `Σ base_amount` over every entry still equals net cash flow.
 *
 * **Cross-currency.** The user supplies both the debited and the credited
 * amount, because those are the two figures on the two statements. Each leg
 * converts to base at its own currency's rate, and the residual
 * `toBase + fromBase` is the realised FX gain or loss. It is reported as
 * `fxEffect` and never absorbed into either amount — absorbing it would silently
 * invent an exchange rate that nobody was charged.
 */

import { eq } from 'drizzle-orm';

import { isoDate } from '../../lib/date';
import { add, isZero, Money, toDbString } from '../../lib/decimal/money';
import { rToDbString } from '../../lib/decimal/rate';
import { createTransferSchema, type CreateTransferInput } from '../../lib/schemas/money';
import { err, ok, validationFailed, type DomainError, type Result } from '../../lib/result';
import { assertEntryInvariants, buildEntries } from '../domain/ledger/entries';
import { transactionEntries, transactions } from '../db/schema';
import type { WriteCtx } from './_ctx';
import { bumpMoneyLedgerVersion } from './_ctx';
import { fieldErrors } from './_validation';
import {
  getTransaction,
  insertTransaction,
  resolveAccount,
  resolveRate,
  type RecordSource,
  type TransactionView,
} from './transactions';
import { setTransactionTags } from './tags';

export interface TransferResult {
  readonly transaction: TransactionView;
  /** `toBase + fromBase`. Zero for a same-currency transfer, by I-3. */
  readonly fxResidual: Money;
}

export async function createTransfer(
  ctx: WriteCtx,
  raw: unknown,
  options: { readonly source?: RecordSource; readonly recurringRuleId?: string | null } = {},
): Promise<Result<TransferResult, DomainError>> {
  const parsed = createTransferSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input: CreateTransferInput = parsed.data;

  const bookedOn = isoDate(input.bookedOn);

  const fromAccount = await resolveAccount(ctx, input.fromAccountId, bookedOn, 'fromAccountId');
  if (!fromAccount.ok) return fromAccount;
  const toAccount = await resolveAccount(ctx, input.toAccountId, bookedOn, 'toAccountId');
  if (!toAccount.ok) return toAccount;

  const sameCurrency = fromAccount.value.currency === toAccount.value.currency;

  // Same currency: one amount, used on both legs — anything else would leave a
  // residual that is not an exchange difference but a typo.
  // Different currencies: both amounts are required, because the pair *is* the
  // rate the user was actually given.
  let fromText: string;
  let toText: string;

  if (sameCurrency) {
    const single = input.amount ?? input.fromAmount ?? input.toAmount;
    if (!single) {
      return err(validationFailed({ amount: ['Enter the amount to transfer.'] }));
    }
    if (input.fromAmount && input.toAmount && input.fromAmount !== input.toAmount) {
      return err(
        validationFailed({
          toAmount: [
            `Both accounts are in ${fromAccount.value.currency}, so the amounts must match. A different pair would be an exchange difference where there is no exchange.`,
          ],
        }),
      );
    }
    fromText = single;
    toText = single;
  } else {
    if (!input.fromAmount || !input.toAmount) {
      return err(
        validationFailed({
          fromAmount: [
            `${fromAccount.value.name} is in ${fromAccount.value.currency} and ${toAccount.value.name} is in ${toAccount.value.currency}. Enter both the amount debited and the amount credited.`,
          ],
        }),
      );
    }
    fromText = input.fromAmount;
    toText = input.toAmount;
  }

  const fromAmount = Money.parseUserInput(fromText, fromAccount.value.currency);
  if (!fromAmount.ok) return err(validationFailed({ fromAmount: [fromAmount.error.message] }));
  const toAmount = Money.parseUserInput(toText, toAccount.value.currency);
  if (!toAmount.ok) return err(validationFailed({ toAmount: [toAmount.error.message] }));

  const fromRate = resolveRate(ctx, fromAccount.value.currency, bookedOn, 'transfer');
  if (!fromRate.ok) return fromRate;
  const toRate = resolveRate(ctx, toAccount.value.currency, bookedOn, 'transfer');
  if (!toRate.ok) return toRate;

  const built = buildEntries(
    {
      kind: 'transfer',
      from: { accountId: fromAccount.value.id, amount: fromAmount.value, fxRateToBase: fromRate.value },
      to: { accountId: toAccount.value.id, amount: toAmount.value, fxRateToBase: toRate.value },
    },
    ctx.base,
  );
  if (!built.ok) return built;

  const invariants = assertEntryInvariants({
    kind: 'transfer',
    categoryId: null,
    categoryKind: null,
    entries: built.value,
  });
  if (!invariants.ok) return invariants;

  const created = await insertTransaction(ctx, {
    kind: 'transfer',
    bookedOn,
    description: input.description,
    categoryId: null,
    notes: input.notes ?? null,
    source: options.source ?? 'manual',
    recurringRuleId: options.recurringRuleId ?? null,
    entries: built.value,
    tags: input.tags,
  });
  if (!created.ok) return created;

  const view = await getTransaction(ctx, created.value);
  if (!view.ok) return view;

  const residual = add(built.value[0]!.baseAmount, built.value[1]!.baseAmount);
  return ok({ transaction: view.value, fxResidual: residual });
}

/**
 * Edit a transfer. Both legs are rebuilt together — a transfer whose two amounts
 * were edited one at a time would spend the interval violating I-3.
 */
export async function updateTransfer(
  ctx: WriteCtx,
  id: string,
  raw: unknown,
): Promise<Result<TransferResult, DomainError>> {
  const before = await getTransaction(ctx, id);
  if (!before.ok) return before;
  if (before.value.kind !== 'transfer') {
    return err(validationFailed({ _: ['That transaction is not a transfer.'] }));
  }

  const parsed = createTransferSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input = parsed.data;

  const bookedOn = isoDate(input.bookedOn);

  const fromAccount = await resolveAccount(ctx, input.fromAccountId, bookedOn, 'fromAccountId');
  if (!fromAccount.ok) return fromAccount;
  const toAccount = await resolveAccount(ctx, input.toAccountId, bookedOn, 'toAccountId');
  if (!toAccount.ok) return toAccount;

  const sameCurrency = fromAccount.value.currency === toAccount.value.currency;
  const fromText = sameCurrency ? (input.amount ?? input.fromAmount) : input.fromAmount;
  const toText = sameCurrency ? (input.amount ?? input.toAmount) : input.toAmount;

  if (!fromText || !toText) {
    return err(
      validationFailed({
        amount: [
          sameCurrency
            ? 'Enter the amount to transfer.'
            : 'Enter both the amount debited and the amount credited.',
        ],
      }),
    );
  }

  const fromAmount = Money.parseUserInput(fromText, fromAccount.value.currency);
  if (!fromAmount.ok) return err(validationFailed({ fromAmount: [fromAmount.error.message] }));
  const toAmount = Money.parseUserInput(toText, toAccount.value.currency);
  if (!toAmount.ok) return err(validationFailed({ toAmount: [toAmount.error.message] }));

  const fromRate = resolveRate(ctx, fromAccount.value.currency, bookedOn, 'transfer');
  if (!fromRate.ok) return fromRate;
  const toRate = resolveRate(ctx, toAccount.value.currency, bookedOn, 'transfer');
  if (!toRate.ok) return toRate;

  const built = buildEntries(
    {
      kind: 'transfer',
      from: { accountId: fromAccount.value.id, amount: fromAmount.value, fxRateToBase: fromRate.value },
      to: { accountId: toAccount.value.id, amount: toAmount.value, fxRateToBase: toRate.value },
    },
    ctx.base,
  );
  if (!built.ok) return built;

  const invariants = assertEntryInvariants({
    kind: 'transfer',
    categoryId: null,
    categoryKind: null,
    entries: built.value,
  });
  if (!invariants.ok) return invariants;

  await ctx.tx
    .update(transactions)
    .set({
      bookedOn,
      description: input.description,
      notes: input.notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, id));

  await ctx.tx.delete(transactionEntries).where(eq(transactionEntries.transactionId, id));
  await ctx.tx.insert(transactionEntries).values(
    built.value.map((draft) => ({
      transactionId: id,
      accountId: draft.accountId,
      amount: toDbString(draft.amount),
      currencyCode: draft.currency,
      fxRateToBase: rToDbString(draft.fxRateToBase),
      baseAmount: toDbString(draft.baseAmount),
      sortOrder: draft.sortOrder,
    })),
  );

  const tagged = await setTransactionTags(ctx, id, input.tags);
  if (!tagged.ok) return tagged;

  await ctx.audit.record({
    actor: 'user',
    action: 'transaction.update',
    entityType: 'transaction',
    entityId: id,
    before: { kind: 'transfer', bookedOn: before.value.bookedOn, description: before.value.description },
    after: {
      kind: 'transfer',
      bookedOn,
      description: input.description,
      entries: built.value.map((e) => ({
        accountId: e.accountId,
        amount: toDbString(e.amount),
        currency: e.currency,
        baseAmount: toDbString(e.baseAmount),
      })),
    },
  });

  await bumpMoneyLedgerVersion(ctx);

  const view = await getTransaction(ctx, id);
  if (!view.ok) return view;

  const residual = add(built.value[0]!.baseAmount, built.value[1]!.baseAmount);
  return ok({ transaction: view.value, fxResidual: residual });
}

/** True when a transfer left a realised FX difference the UI should surface. */
export function hasFxResidual(result: TransferResult): boolean {
  return !isZero(result.fxResidual);
}
