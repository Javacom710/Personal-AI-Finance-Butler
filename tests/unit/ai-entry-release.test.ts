import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), apply: vi.fn(), reject: vi.fn() }));
vi.mock('@/server/auth/guards', () => ({ requireSession: mocks.auth }));
vi.mock('@/server/services', () => ({ createReadCtx: mocks.context, applyTransactionProposal: mocks.apply, rejectTransactionProposal: mocks.reject }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { draftTransactionAction, confirmTransactionProposalAction } from '@app/(app)/money/proposals/actions';
import { EMPTY_ACTION_STATE } from '@app/(app)/money/form-state';

beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: 'test-user' }); });
describe('natural-language entry release boundary', () => {
  it('authenticates direct POSTs but never composes a live provider or writes a draft', async () => {
    const form = new FormData(); form.set('text', 'Spent 500');
    const result = await draftTransactionAction(EMPTY_ACTION_STATE, form);
    expect(mocks.auth).toHaveBeenCalledWith('/money/proposals');
    expect(result.status).toBe('error'); expect(result.message).toMatch(/approval/);
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('does not let unauthenticated requests reach the release boundary', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('login required'));
    await expect(draftTransactionAction(EMPTY_ACTION_STATE, new FormData())).rejects.toThrow('login required');
  });
});

it('keeps confirmation amounts as decimal strings when translating FormData', async () => {
  mocks.context.mockResolvedValue({ ok: true, value: { userId: 'test-user' } });
  mocks.apply.mockResolvedValue({ ok: false, error: { code: 'validation_failed', message: 'validation failed', fieldErrors: { amount: ['Review amount'] } } });
  const form = new FormData(); form.set('amount', '0.0001'); form.set('confirmed', 'true');
  const result = await confirmTransactionProposalAction(EMPTY_ACTION_STATE, form);
  expect(mocks.apply.mock.calls[0]?.[1].values.amount).toBe('0.0001');
  expect(result.fieldErrors.amount).toEqual(['Review amount']);
  expect(result.edits?.amount).toBe('0.0001');
  expect(result.revision).toBe(1);
});

it('retains all raw corrections on context failure, without calling apply', async () => {
  mocks.context.mockResolvedValue({ ok: false, error: { code: 'not_found', message: 'Settings unavailable' } });
  const form = new FormData();
  for (const [key, value] of Object.entries({ amount: '987.6500', accountId: 'other', description: 'Corrected dinner', notes: 'Keep my correction', tags: 'personal, dinner' })) form.set(key, value);
  const result = await confirmTransactionProposalAction({ ...EMPTY_ACTION_STATE, revision: 1 }, form);
  expect(result.status).toBe('error'); expect(result.revision).toBe(2);
  expect(result.edits).toMatchObject({ amount: '987.6500', accountId: 'other', description: 'Corrected dinner', notes: 'Keep my correction', tags: 'personal, dinner' });
  expect(mocks.apply).not.toHaveBeenCalled();
});
