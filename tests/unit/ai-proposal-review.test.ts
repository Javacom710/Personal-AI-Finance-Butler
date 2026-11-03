import { createElement } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProposalReviewState } from '@app/(app)/money/proposals/review-state';
const action = vi.hoisted(() => ({ state: undefined as ProposalReviewState | undefined }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof React>();
  return { ...actual, useActionState: (_action: unknown, initial: unknown) => [action.state ?? initial, () => {}, false] };
});
beforeEach(() => { action.state = undefined; });
vi.mock('@app/(app)/money/proposals/actions', () => ({ confirmTransactionProposalAction: vi.fn(), rejectTransactionProposalAction: vi.fn() }));
import { ProposalReview, type ReviewProps } from '@app/(app)/money/proposals/_review';
const props: ReviewProps = { id: 'proposal', draft: { kind: 'expense', bookedOn: '2026-08-10', amount: '0.0001', currency: 'INR', accountId: 'bank', toAccountId: null, categoryId: 'food', toAmount: null, description: '<script>alert(1)</script>', notes: null, tags: [] }, errors: { amount: ['Review the amount'] }, expiresAt: 'tomorrow', expiresAtIso: '2026-11-04T00:00:00Z', expired: false, preview: 'Expense draft · Bank', accounts: [{ id: 'bank', name: 'Bank', currency: 'INR' }], categories: [{ id: 'food', path: 'Food', kind: 'expense' }] };
describe('transaction review UI', () => {
  it('shows field-level errors, confirmation and exact decimal text, escaping untrusted model text', () => {
    const html = renderToStaticMarkup(createElement(ProposalReview, props));
    expect(html).toContain('Review the amount'); expect(html).toContain('name="amount"'); expect(html).toContain('value="0.0001"');
    expect(html).not.toContain('type="number"'); expect(html).toContain('name="confirmed"'); expect(html).toContain('name="reviewAcknowledged"');
    expect(html).not.toContain('<script>alert(1)</script>'); expect(html).toContain('&lt;script&gt;');
  });
  it('restores rejected user edits as form defaults and requires fresh confirmation', () => {
    action.state = { status: 'error', message: 'Check fields', fieldErrors: { amount: ['Review amount'] }, revision: 2,
      edits: { kind: 'expense', bookedOn: '2026-11-02', amount: '987.6500', currency: 'INR', accountId: 'other', categoryId: 'food', toAccountId: '', toAmount: '', description: 'Corrected dinner', notes: 'Keep my correction', tags: 'personal, dinner' } };
    const html = renderToStaticMarkup(createElement(ProposalReview, { ...props, accounts: [...props.accounts, { id: 'other', name: 'Other', currency: 'INR' }] }));
    expect(html).toContain('value="987.6500"'); expect(html).toContain('value="Corrected dinner"');
    expect(html).toContain('value="Keep my correction"'); expect(html).toContain('value="personal, dinner"');
    expect(html).toMatch(/<option(?=[^>]*value="other")(?=[^>]*selected="")[^>]*>/);
    expect(html).not.toMatch(/<input(?=[^>]*name="confirmed")(?=[^>]*checked)[^>]*>/);
  });
  it('disables confirmation when expired', () => {
    const html = renderToStaticMarkup(createElement(ProposalReview, { ...props, expired: true }));
    expect(html).toContain('Expired. This draft cannot be confirmed.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm transaction/);
  });
  it('does not silently select another account if the resolved one is no longer available', () => {
    const html = renderToStaticMarkup(createElement(ProposalReview, { ...props, accounts: [{ id: 'other', name: 'Other', currency: 'INR' }] }));
    expect(html).toMatch(/<option(?=[^>]*value="")(?=[^>]*selected="")[^>]*>Choose an account/);
  });
});

it('keeps a missing document date blank while preserving the proposed decimal amount and field error', () => {
  const html = renderToStaticMarkup(createElement(ProposalReview, { ...props, draft: { ...props.draft!, bookedOn: null }, errors: { bookedOn: ['Enter the missing transaction date before confirming.'] } }));
  expect(html).toMatch(/<input(?=[^>]*name="bookedOn")(?=[^>]*value="")[^>]*>/);
  expect(html).toContain('value="0.0001"'); expect(html).toContain('Enter the missing transaction date');
});
