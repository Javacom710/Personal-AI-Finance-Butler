'use server';
import { requireSession } from '@/server/auth/guards';
export async function generateCrossDomainAnalysisAction() {
  await requireSession('/ai/reviews/cross-domain');
  return { status: 'unavailable' as const, message: 'Cross-domain analysis awaits setup approval. No financial data has been sent to a model.' };
}
