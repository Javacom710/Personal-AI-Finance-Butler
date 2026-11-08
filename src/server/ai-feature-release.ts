import 'server-only';

/** Existing owner-review hold. Only a reviewed code change can release it. */
export function isTier1GenerationReleased(): boolean {
  return false;
}
