'use server';
import { requireSession } from '@/server/auth/guards';
export async function generatePeriodSummaryAction() {
  await requireSession('/ai/reviews/summary');
  return { status: 'unavailable' as const, message: 'Period summaries await setup approval. No financial data has been sent to a model.' };
}
