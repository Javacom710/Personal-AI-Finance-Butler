/**
 * Postgres types Drizzle has no first-class builder for.
 *
 * Each of these is named in SCHEMA.md and chosen for a reason the application
 * relies on, so none of them is substituted for a `text` column of convenience.
 */

import { customType } from 'drizzle-orm/pg-core';

/**
 * Case-insensitive text. `users.email` is `citext` so that `Alice@x.com` and
 * `alice@x.com` cannot become two accounts — enforced by the database rather
 * than by every call site remembering to lowercase.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

/**
 * Raw bytes. Session token hashes and encrypted TOTP secrets are bytes, not
 * text; storing them hex-encoded in a `text` column invites a comparison
 * against the wrong encoding.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
  fromDriver: (value: unknown) => value as Buffer,
  toDriver: (value: Buffer) => value,
});

/**
 * An IP address. `inet` validates the value and stores v4 and v6 compactly;
 * `text` would accept "not an ip".
 */
export const inet = customType<{ data: string; driverData: string }>({
  dataType: () => 'inet',
});
