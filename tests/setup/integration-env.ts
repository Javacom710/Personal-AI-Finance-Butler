/**
 * Per-file environment for the integration layer.
 *
 * `DATABASE_URL` is redirected to the **application role on the test database**
 * before any module reads it, so `db()` in the code under test connects exactly
 * as the production server would — least privilege included.
 */

import { loadDotEnv, resetEnvCache } from '../../src/lib/env';

loadDotEnv();

const appUrl = process.env['TEST_DATABASE_APP_URL'];
if (!appUrl) {
  throw new Error('TEST_DATABASE_APP_URL is not set — see .env.example.');
}

// NODE_ENV is set to 'test' by Vitest and is read-only in the Node types.
process.env['DATABASE_URL'] = appUrl;
process.env['APP_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
process.env['SESSION_COOKIE_SECRET'] = Buffer.alloc(32, 11).toString('base64');
process.env['APP_ORIGIN'] = 'http://localhost:3000';
process.env['LOG_LEVEL'] = 'error';

resetEnvCache();
