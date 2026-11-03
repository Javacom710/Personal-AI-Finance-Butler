'use server';
import { requireSession } from '@/server/auth/guards';

/** No runtime is composed before the owner accepts a measured lineup. */
export async function askFinanceQuestionAction(): Promise<{ status: 'unavailable'; message: string }> {
  await requireSession('/ai');
  return { status: 'unavailable', message: 'The financial assistant is awaiting setup approval. Your question has not been sent to a model.' };
}
