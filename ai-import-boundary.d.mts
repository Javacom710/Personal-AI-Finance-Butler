/**
 * Types for {@link file://./ai-import-boundary.mjs}. The runtime module is plain
 * JavaScript so that `eslint.config.mjs` can import it at config-load time (that
 * process runs no TypeScript loader); this declaration lets the source-scan test
 * import it under `tsc` all the same.
 */

export type TargetLabel =
  | 'allowed'
  | 'env-secrets'
  | 'ai-runtime'
  | 'ai-read-internal'
  | 'health'
  | 'db'
  | 'domain'
  | 'services'
  | 'jobs'
  | 'auth'
  | 'market-data'
  | 'app-actions'
  | 'query-builder'
  | 'wire-client'
  | 'package-not-allowed'
  | 'dynamic-unresolved'
  | 'server-other';

export type ResolvedSpecifier =
  | { kind: 'bare'; name: string }
  | { kind: 'internal'; key: string }
  | { kind: 'unresolved' };

export function resolveSpecifier(importerRel: string, spec: string | null | undefined): ResolvedSpecifier;
export function classifyTarget(importerRel: string, spec: string | null | undefined): TargetLabel;
export function isAllowedFromAiZone(importerRel: string, spec: string | null | undefined): boolean;
export const DENY_REASON: Record<string, string>;
export const ALLOWED_PACKAGES: readonly string[];
export const AI_ZONE_GLOB: string;
export const AI_WIRE_CLIENT_FILE: string;
