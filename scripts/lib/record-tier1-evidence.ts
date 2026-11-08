/** Explicit operator-only import. Never imported by a page, action or runtime. */
import { and, gte, inArray, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { aiProviderSettings, env } from '../../src/lib/env';
import { db } from '../../src/server/db/client';
import { aiModelEvaluations } from '../../src/server/db/schema';
import { evaluationProviderIdentity, recordEvaluationRun, type EvaluationDetail } from '../../src/server/ai-evaluations';
import { resolveModelConfig } from '../../src/server/ai/config/models';
import { matchesRequestProfile } from '../../src/server/ai/config/request-profiles';
import { prepareTier1Evidence } from './tier1-evidence';

export async function recordTier1Evidence(files: Readonly<Record<string, string>>, expectedDigest: string) {
  const prepared = prepareTier1Evidence(files);
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || expectedDigest !== prepared.preview.digest) throw new Error('The reviewed digest does not match these evidence bytes and recording rows.');
  const e = env();
  const config = resolveModelConfig({ tier1: e.AI_TIER1_MODELS, requestProfiles: e.AI_REQUEST_PROFILES });
  if (evaluationProviderIdentity(aiProviderSettings(e).baseUrl) !== prepared.run.providerIdentity ||
    !isDeepStrictEqual(config.candidates(1), prepared.run.proposedOrder) ||
    prepared.run.models.some(m => !matchesRequestProfile(m.requestProfile, config.requestProfiles.forModel(m.modelId)))) throw new Error('Deployment provider, Tier 1 order or request profiles differ from the reviewed evidence.');
  const { run, rows } = prepared;
  return db().transaction(async tx => {
    // Serialize this import command, including identical concurrent invocations.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('financeos:tier1-evidence-import', 0))`);
    const existing = await tx.select().from(aiModelEvaluations).where(and(inArray(aiModelEvaluations.model, run.models.map(m => m.modelId)), inArray(aiModelEvaluations.suite, rows.map(r => r.suite)), gte(aiModelEvaluations.runAt, new Date(run.startedAt))));
    const relevant = existing.filter(row => {
      const detail = row.detail as Partial<EvaluationDetail> | null;
      return row.tier === 1 && detail?.providerIdentity === run.providerIdentity && matchesRequestProfile(detail?.requestProfile, config.requestProfiles.forModel(row.model));
    });
    if (relevant.some(row => row.runAt.getTime() > new Date(run.startedAt).getTime())) throw new Error('Newer matching deployment evidence exists; do not revive this older campaign.');
    const atSameTime = existing.filter(row => row.runAt.getTime() === new Date(run.startedAt).getTime() &&
      (relevant.includes(row) || rows.some(r => r.model === row.model && r.suite === row.suite && r.evalVersion === row.evalVersion)));
    if (atSameTime.length) {
      const exact = atSameTime.length === rows.length && rows.every(wanted => atSameTime.some(row => {
        const projected = Object.fromEntries(Object.keys(wanted).map(key => [key, row[key as keyof typeof row]]));
        return isDeepStrictEqual(projected, wanted);
      }));
      if (!exact) throw new Error('Conflicting or partial evidence already exists at the campaign timestamp.');
      return { status: 'already_recorded' as const, digest: expectedDigest, insertedRows: 0 };
    }
    const insertedRows = await recordEvaluationRun(run, tx);
    if (insertedRows !== rows.length) throw new Error('Evidence batch was incomplete.');
    return { status: 'recorded' as const, digest: expectedDigest, insertedRows };
  });
}
