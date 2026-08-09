/**
 * The authoritative schema definition (SCHEMA.md preamble). `drizzle-kit`
 * generates the checked-in migrations from exactly these files.
 *
 * Phase 2 defines identity, reference data, settings, and operational tables.
 * Money (Phase 3), investments (Phase 4), net worth (Phase 5) and AI (Phase 7)
 * add their own files here as they are built.
 */

export * from './enums';
export * from './identity';
export * from './reference';
export * from './settings';
export * from './ops';
