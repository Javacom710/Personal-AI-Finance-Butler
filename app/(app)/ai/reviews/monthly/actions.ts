'use server';
import { requireSession } from '@/server/auth/guards';
/** Hard release boundary, independent of browser controls and environment keys. */
export async function generateMonthlyReviewAction() {
  await requireSession('/ai/reviews/monthly');
  return { status: 'unavailable' as const, message: 'Monthly financial reviews await setup approval. No financial data has been sent to a model.' };
}
