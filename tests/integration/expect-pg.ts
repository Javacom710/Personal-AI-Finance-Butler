import { expect } from 'vitest';

/**
 * Assert that a query failed for lack of privilege.
 *
 * Matching on the message does not work: Drizzle wraps a driver error as
 * `Failed query: …` and keeps the original as `cause`, so the words "permission
 * denied" are not in the top-level message. The SQLSTATE is the reliable
 * signal — `42501` is `insufficient_privilege`.
 */
const INSUFFICIENT_PRIVILEGE = '42501';

function findCode(error: unknown, depth = 0): string | undefined {
  if (depth > 5 || typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string') return candidate.code;
  return findCode(candidate.cause, depth + 1);
}

export async function expectPermissionDenied(
  run: () => Promise<unknown>,
  what: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown, `${what} should have been refused, but it succeeded`).toBeDefined();
  expect(findCode(thrown), `${what} failed, but not for lack of privilege`).toBe(
    INSUFFICIENT_PRIVILEGE,
  );
}

/** As above, for operations Postgres refuses with "must be owner" (SQLSTATE 42501 as well). */
export const expectRefused = expectPermissionDenied;
