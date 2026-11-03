import 'server-only';
export interface EvidenceItem { readonly path: string; readonly value: unknown; readonly category: 'fact' | 'calculation' }
/** Projection only. No arithmetic, precision conversion or null replacement. */
export function reviewEvidence(value: unknown, path = ''): EvidenceItem[] {
  if (value === null || typeof value !== 'object') return [{ path, value, category: path === 'ok' || path.startsWith('meta.') ? 'fact' : typeof value === 'number' || typeof value === 'boolean' || value === null ? 'calculation' : 'fact' }];
  if (Array.isArray(value)) return value.length ? value.flatMap((v, i) => reviewEvidence(v, `${path}[${i + 1}]`)) : [{ path, value: 'No rows', category: 'fact' }];
  const object = value as Record<string, unknown>;
  if (['money', 'price', 'quantity', 'rate'].includes(String(object.kind)) || ('value' in object && 'unavailableReason' in object)) return [{ path, value, category: 'calculation' }];
  return Object.entries(object).flatMap(([key, v]) => reviewEvidence(v, path ? `${path}.${key}` : key));
}
