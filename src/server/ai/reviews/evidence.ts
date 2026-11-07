import 'server-only';
export interface EvidenceItem { readonly path: string; readonly value: unknown; readonly category: 'fact' | 'calculation' }
/** Projection only. No arithmetic, precision conversion or null replacement. */
export function reviewEvidence(value: unknown, path = ''): EvidenceItem[] {
  const field = path.slice(path.lastIndexOf('.') + 1);
  const recorded = ['creditLimit', 'outstanding', 'emiAmount', 'interestRate', 'amountText'].includes(field);
  if (value === null || typeof value !== 'object') return [{ path, value, category: recorded || path === 'ok' || path.startsWith('meta.') ? 'fact' : typeof value === 'number' || value === null || field === 'overBudget' ? 'calculation' : 'fact' }];
  if (Array.isArray(value)) return value.length ? value.flatMap((v, i) => {
    const row = v !== null && typeof v === 'object' ? v as Record<string, unknown> : {};
    const name = row.name ?? row.label ?? row.symbol ?? row.category;
    return reviewEvidence(v, `${path}[${i + 1}${typeof name === 'string' ? `: ${name}` : ''}]`);
  }) : [{ path, value: 'No rows', category: 'fact' }];
  const object = value as Record<string, unknown>;
  if (['money', 'price', 'quantity', 'rate'].includes(String(object.kind)) || ('value' in object && 'unavailableReason' in object)) return [{ path, value, category: recorded ? 'fact' : 'calculation' }];
  return Object.entries(object).filter(([key]) => !['id', 'key', 'parentKey', 'instrumentId', 'accountId'].includes(key)).flatMap(([key, v]) => reviewEvidence(v, path ? `${path}.${key}` : key));
}
