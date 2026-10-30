/**
 * Runs once when the Next.js server starts (not during `next build`).
 *
 * B-3b: a tier list naming a model with no capability entry stops the server
 * here, with the model named, instead of degrading one request at a time.
 * Only the Node.js runtime has the server modules; the edge runtime skips it.
 */
export async function register(): Promise<void> {
  // The one environment read outside src/lib/env.ts: Next.js sets NEXT_RUNTIME
  // itself, and env.ts cannot be loaded in the edge runtime this guards against.
  // eslint-disable-next-line no-restricted-syntax
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertAiConfiguration } = await import('./src/server/ai-runtime');
  assertAiConfiguration();
}
