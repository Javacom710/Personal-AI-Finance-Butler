/**
 * The authoritative schema definition (SCHEMA.md preamble). `drizzle-kit`
 * generates the checked-in migrations from exactly these files.
 *
 * Phase 2 defined identity, reference data, settings, and operational tables;
 * Phase 3 added the money core; Phase 4 added instruments, prices and the
 * investment ledger; Phase 5 adds manual assets and liabilities. AI (Phase 7)
 * adds its own file here when it is built.
 *
 * Phase 5 adds **no `net_worth_snapshots`**: net worth is derived on demand, and
 * the snapshot table is Phase 6 work if measurement justifies it
 * ([ADR-24](../../../../docs/DECISIONS.md)).
 */

export * from './enums';
export * from './identity';
export * from './reference';
export * from './settings';
export * from './ops';
export * from './money';
export * from './investments';
export * from './networth';
