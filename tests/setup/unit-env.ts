/**
 * Environment for the unit and property layers.
 *
 * These layers touch no database, but modules under test read `src/lib/env.ts`
 * transitively, and that module refuses to boot on a missing secret — correctly
 * (SECURITY.md §3). Supplying fixed, obviously-fake values keeps that behaviour
 * intact while making the tests independent of the developer's `.env`.
 */

// NODE_ENV is set to 'test' by Vitest and is read-only in the Node types.
process.env['DATABASE_URL'] ??= 'postgres://unit:unit@127.0.0.1:5432/unit_never_connected';
process.env['DATABASE_MIGRATION_URL'] ??= 'postgres://unit:unit@127.0.0.1:5432/unit_never_connected';
// Deterministic 32-byte keys so encryption tests are reproducible. Fixed test
// values, never used anywhere but here.
process.env['APP_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
process.env['SESSION_COOKIE_SECRET'] = Buffer.alloc(32, 11).toString('base64');
process.env['APP_ORIGIN'] = 'http://localhost:3000';
process.env['LOG_LEVEL'] = 'error';
