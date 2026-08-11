import type { Metadata } from 'next';

import { PageHeader } from '../../../_components/page-shell';
import { Disclosure, InlineAction } from '../../money/_components';
import { loadMoneyContext } from '../../money/_page-data';
import { listCurrencies, listInstruments } from '@/server/services';
import { InstrumentForm, PriceForm } from '../_forms';
import { createInstrumentAction, deleteInstrumentAction, setInstrumentActiveAction, setPriceAction } from '../actions';
import { NavTabs, TABLE, TD, TD_NUM, TH, TH_NUM } from '../_components';

export const metadata: Metadata = { title: 'Instruments' };

export default async function InstrumentsPage() {
  const { ctx } = await loadMoneyContext('/investments/instruments');
  const [instruments, currencies] = await Promise.all([
    listInstruments(ctx, { includeInactive: true }),
    listCurrencies(ctx),
  ]);

  const options = instruments
    .filter((i) => i.isActive)
    .map((i) => ({ id: i.id, label: i.symbol, currency: i.currency }));

  return (
    <>
      <PageHeader
        title="Instruments"
        description="What is held, independent of how much. Not coupled to any broker or exchange."
        actions={<NavTabs current="/investments/instruments" />}
      />

      <Disclosure summary="Add an instrument">
        <InstrumentForm
          action={createInstrumentAction}
          currencies={currencies.map((c) => c.code)}
          baseCurrency={ctx.base}
        />
      </Disclosure>

      {options.length > 0 ? (
        <Disclosure summary="Record a price">
          <PriceForm action={setPriceAction} instruments={options} />
        </Disclosure>
      ) : null}

      {instruments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong bg-surface-sunken px-6 py-8 text-center text-sm text-ink-muted">
          No instruments yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className={TABLE}>
            <thead className="bg-surface-sunken">
              <tr>
                <th className={TH}>Symbol</th>
                <th className={TH}>Name</th>
                <th className={TH}>Class</th>
                <th className={TH}>Exchange</th>
                <th className={TH}>Currency</th>
                <th className={TH}>Basis</th>
                <th className={TH_NUM}>Ledger rows</th>
                <th className={TH_NUM}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {instruments.map((instrument) => (
                <tr key={instrument.id} className="border-t border-border">
                  <td className={`${TD} font-medium`}>
                    {instrument.symbol}
                    {instrument.isActive ? null : (
                      <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-ink-faint">
                        inactive
                      </span>
                    )}
                  </td>
                  <td className={TD}>{instrument.name}</td>
                  <td className={TD}>{instrument.assetClass.replace(/_/g, ' ')}</td>
                  <td className={TD}>{instrument.exchange ?? '—'}</td>
                  <td className={TD}>{instrument.currency}</td>
                  <td className={TD}>{instrument.costBasisMethod.toUpperCase()}</td>
                  <td className={TD_NUM}>{instrument.transactionCount}</td>
                  <td className={TD_NUM}>
                    <div className="flex justify-end gap-2">
                      <InlineAction
                        action={setInstrumentActiveAction}
                        values={{ id: instrument.id, isActive: String(!instrument.isActive) }}
                        label={instrument.isActive ? 'Deactivate' : 'Reactivate'}
                      />
                      {instrument.transactionCount === 0 ? (
                        <InlineAction
                          action={deleteInstrumentAction}
                          values={{ id: instrument.id }}
                          label="Delete"
                          confirm={`Delete ${instrument.symbol}?`}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-faint">
        An instrument with ledger history cannot be deleted — the database refuses it. Deactivating
        one keeps its history and removes it from the pickers.
      </p>
    </>
  );
}
