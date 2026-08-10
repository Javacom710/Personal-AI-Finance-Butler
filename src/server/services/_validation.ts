import 'server-only';

/**
 * Zod errors, rendered per field.
 *
 * `validation_failed` carries `fieldErrors: Record<string, string[]>` so a form
 * can put each message beside the input that caused it. One translation, used by
 * every service, so the shape a server action receives never depends on which
 * service produced it.
 */

import { validationFailed, type DomainError } from '../../lib/result';

export interface ZodLikeError {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
}

export function fieldErrors(error: ZodLikeError): DomainError {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    // An issue with no path is about the object as a whole — a cross-field
    // refinement. `_` is the key the form renders above the fields.
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return validationFailed(out);
}
