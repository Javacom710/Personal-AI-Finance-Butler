'use server';
import { requireSession } from '@/server/auth/guards';
export async function generateDocumentDraftsAction() {
  await requireSession('/ai/documents');
  return { status: 'unavailable' as const, message: 'Document extraction awaits setup approval. No image or financial data has been sent to a model.' };
}
