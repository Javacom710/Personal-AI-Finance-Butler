'use server';
import { requireSession } from '@/server/auth/guards';
export async function generateFinancialHealthAction() {
  await requireSession('/ai/reviews/health');
  return { status: 'unavailable' as const, message: 'Financial-health analysis awaits setup approval. No financial data has been sent to a model.' };
}
