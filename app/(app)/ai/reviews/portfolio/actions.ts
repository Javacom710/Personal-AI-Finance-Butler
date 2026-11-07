'use server';
import { requireSession } from '@/server/auth/guards';
export async function generatePortfolioAnalysisAction() {
  await requireSession('/ai/reviews/portfolio');
  return { status: 'unavailable' as const, message: 'Portfolio analysis awaits setup approval. No financial data has been sent to a model.' };
}
