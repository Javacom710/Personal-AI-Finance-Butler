/**
 * The authoritative schema definition (SCHEMA.md preamble). `drizzle-kit`
 * generates the checked-in migrations from exactly these files.
 *
 * Phase 2 defined identity, reference data, settings, and operational tables;
 * Phase 3 added the money core; Phase 4 adds instruments, prices and the
 * investment ledger. Net worth (Phase 5) and AI (Phase 7) add their own files
 * here as they are built.
 */

export * from './enums';
export * from './identity';
export * from './reference';
export * from './settings';
export * from './ops';
export * from './money';
export * from './investments';
