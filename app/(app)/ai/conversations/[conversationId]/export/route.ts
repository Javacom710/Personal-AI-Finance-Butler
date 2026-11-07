import { requireSession } from '@/server/auth/guards';
import { createReadCtx, exportConversation } from '@/server/services';

export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const session = await requireSession('/ai');
  const ctx = await createReadCtx(session.userId);
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!ctx.ok) return Response.json({ error: 'Conversation settings unavailable.' }, { status: 503, headers });
  const { conversationId } = await params;
  const result = await exportConversation(ctx.value, conversationId);
  if (!result.ok) return Response.json({ error: 'Conversation unavailable.' }, { status: 404, headers });
  return Response.json(result.value, { headers: { ...headers, 'Content-Disposition': `attachment; filename="conversation-${result.value.conversation.id}.json"` } });
}
