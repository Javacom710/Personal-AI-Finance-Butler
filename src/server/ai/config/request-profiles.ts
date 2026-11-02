import 'server-only';

/** Application configuration, never an instruction supplied in a conversation. */
export interface RequestProfileIdentity {
  readonly id: string;
  /** Canonical semantic description; changes whenever request controls change. */
  readonly fingerprint: string;
}

export interface RequestProfile extends RequestProfileIdentity {
  readonly reasoning: 'provider_default' | 'disabled';
}

function profile(id: string, reasoning: RequestProfile['reasoning']): RequestProfile {
  return Object.freeze({ id, reasoning, fingerprint: JSON.stringify({ id, reasoning }) });
}

export const DEFAULT_REQUEST_PROFILE = profile('default-v1', 'provider_default');
export const THINKING_DISABLED_PROFILE = profile('lightning-thinking-disabled-v1', 'disabled');
const LIGHTNING = 'nvidia/nemotron-3.5-lightning-30b-a3b';

/** Reject unknown profiles and unsupported model/profile pairs before egress. */
export function requestProfileById(model: string, id: unknown): RequestProfile {
  if (id === DEFAULT_REQUEST_PROFILE.id) return DEFAULT_REQUEST_PROFILE;
  if (id === THINKING_DISABLED_PROFILE.id && model === LIGHTNING) return THINKING_DISABLED_PROFILE;
  throw new Error('Unknown request profile or unsupported model/profile pair.');
}

export interface RequestProfiles {
  forModel(model: string): RequestProfile;
}

/** A JSON model → profile-id map read by the composition root, not by AI code. */
export function resolveRequestProfiles(raw = ''): RequestProfiles {
  const overrides = new Map<string, RequestProfile>();
  if (raw.trim()) {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('AI_REQUEST_PROFILES must be a JSON object.'); }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('AI_REQUEST_PROFILES must be a JSON object.');
    }
    for (const [model, id] of Object.entries(value)) {
      if (!model.trim() || model !== model.trim()) throw new Error('Invalid model key in AI_REQUEST_PROFILES.');
      overrides.set(model, requestProfileById(model, id));
    }
  }
  return Object.freeze({ forModel: (model: string) => overrides.get(model) ?? DEFAULT_REQUEST_PROFILE });
}

/** Missing legacy provenance certifies only the unchanged default profile. */
export function matchesRequestProfile(value: unknown, active: RequestProfileIdentity): boolean {
  if (value === undefined) return active.id === DEFAULT_REQUEST_PROFILE.id && active.fingerprint === DEFAULT_REQUEST_PROFILE.fingerprint;
  if (value === null || typeof value !== 'object') return false;
  const identity = value as Partial<RequestProfileIdentity>;
  return identity.id === active.id && identity.fingerprint === active.fingerprint;
}

/** Store only the identity, not a mutable collection of provider wire overrides. */
export function requestProfileIdentity(profile: RequestProfileIdentity): RequestProfileIdentity {
  return Object.freeze({ id: profile.id, fingerprint: profile.fingerprint });
}
