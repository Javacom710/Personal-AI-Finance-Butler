import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@app/(app)/money/proposals/actions', () => ({ confirmTransactionProposalAction: vi.fn(), rejectTransactionProposalAction: vi.fn() }));
import { ProposalReview, type ReviewProps } from '@app/(app)/money/proposals/_review';
const props: ReviewProps = { id: 'proposal', draft: { kind: 'expense', bookedOn: '2026-08-10', amount: '0.0001', currency: 'INR', accountId: 'bank', toAccountId: null, categoryId: 'food', toAmount: null, description: '<script>alert(1)</script>', notes: null, tags: [] }, errors: { amount: ['Review the amount'] }, expiresAt: 'tomorrow', expired: false, preview: 'Expense draft · Bank', accounts: [{ id: 'bank', name: 'Bank', currency: 'INR' }], categories: [{ id: 'food', path: 'Food', kind: 'expense' }] };
describe('transaction review UI', () => {
  it('shows field-level errors, confirmation and exact decimal text, escaping untrusted model text', () => {
    const html = renderToStaticMarkup(createElement(ProposalReview, props));
    expect(html).toContain('Review the amount'); expect(html).toContain('name="amount"'); expect(html).toContain('value="0.0001"');
    expect(html).not.toContain('type="number"'); expect(html).toContain('name="confirmed"'); expect(html).toContain('name="reviewAcknowledged"');
    expect(html).not.toContain('<script>alert(1)</script>'); expect(html).toContain('&lt;script&gt;');
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
