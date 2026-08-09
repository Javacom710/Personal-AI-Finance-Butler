/**
 * The single, validated view of the environment (SECURITY.md §3).
 *
 * A missing or malformed secret fails here, at first access, with a message
 * naming the variable — rather than surfacing later as an opaque connection or
 * decryption error. Nothing else in the codebase touches `process.env`; an
 * ESLint rule enforces that.
 *
 * This module deliberately does **not** `import 'server-only'`: the seed,
 * migration and integrity scripts run outside Next, where that package throws.
 * The browser guard below covers the same risk, and
 * `npm run check:no-client-secrets` scans the built client bundles.
 */

import { z } from 'zod';

if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/env.ts was imported into browser code. It holds server-only secrets and must never ship to a client bundle.',
  );
}

const base64Key32 = z
  .string()
  .refine(
    (s) => {
      try {
        return Buffer.from(s, 'base64').length === 32;
      } catch {
        return false;
      }
    },
    { message: 'must be exactly 32 bytes, base64-encoded (generate with crypto.randomBytes(32))' },
  );

const postgresUrl = z
  .string()
  .refine((s) => s.startsWith('postgres://') || s.startsWith('postgresql://'), {
    message: 'must be a postgres:// connection string',
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** The application role: DML only, no DDL, append-only on audit_log (SECURITY.md §2). */
  DATABASE_URL: postgresUrl,

  /** The migration role: the only role holding DDL rights. Used by scripts, never by the server. */
  DATABASE_MIGRATION_URL: postgresUrl,

  /** Encrypts TOTP secrets at rest with AES-256-GCM. Never stored in the database. */
  APP_ENCRYPTION_KEY: base64Key32,

  /**
   * Signs the short-lived cookie that carries a half-finished login between the
   * password step and the TOTP step. The *session* cookie is not signed — it is
   * an opaque random token whose SHA-256 is stored (SECURITY.md §1) — so this
   * key protects only the intermediate challenge.
   */
  SESSION_COOKIE_SECRET: base64Key32,

  APP_ORIGIN: z.url().default('http://localhost:3000'),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Parsed lazily so that importing a module which transitively reaches this one
 * does not require a full environment — `next build` collects page metadata
 * without a database, and the test runner sets variables in its own setup.
 */
export function env(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = Object.entries(z.flattenError(parsed.error).fieldErrors)
      .map(([key, errors]) => `  ${key}: ${(errors ?? []).join('; ')}`)
      .join('\n');
    throw new Error(
      `Invalid environment. Refusing to start.\n${detail}\n\nSee .env.example for every variable this application requires.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test and script support: re-read the environment after mutating `process.env`. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = (): boolean => env().NODE_ENV === 'production';
export const isTest = (): boolean => env().NODE_ENV === 'test';

/**
 * Load `.env` for processes Next does not start (scripts, the test runner).
 * `next dev`/`build`/`start` load it themselves, so this is a no-op there.
 */
export function loadDotEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // Absent .env is fine when the variables are already set — CI, for instance.
  }
}
