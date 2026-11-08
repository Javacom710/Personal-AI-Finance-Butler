/** Reviewed retained Tier 1 campaign → canonical recording rows. No environment, DB or network access. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { evaluationRowsForRun, tierCapabilitiesFromEvaluations } from '../../src/server/ai-evaluations';
import { createCapabilityMatrix } from '../../src/server/ai/config/capabilities';
import { resolveModelConfig } from '../../src/server/ai/config/models';
import { requestProfileIdentity } from '../../src/server/ai/config/request-profiles';
import { maxTokensFor, MODEL_SUITES, proposeOrder, summarise, TIER_SUITES, type EvalRun } from '../../src/server/ai/eval/runner';
import { selectCandidates } from '../../src/server/ai/orchestrator/select';
import { requirementFor } from '../../src/server/ai/orchestrator/requirements';
import { createHealthRegistry } from '../../src/server/ai/orchestrator/breaker';
import { assessEntry, checkpointReport } from './ai-measurement-workflow';

export const TIER1_CAMPAIGN = 'tier1-parse-v4-2026-11-08';
export const TIER1_EVIDENCE_DIRECTORY = `eval/reports/deepinfra-2026-11-07-${TIER1_CAMPAIGN}`;
const sourceFingerprint = 'bfc6accec0ebf384b5f04372fa67771ae4502ea99a42e3a7f1b3c5b1978b727d';
const endpoint = 'https://api.deepinfra.com/v1/openai';
const config = resolveModelConfig();
const models = config.candidates(1);
const suites = TIER_SUITES[1];
export const checkpointName = (model: string, suite: string) => `checkpoint-tier1-${suite}-${model.replace(/[^a-zA-Z0-9-]/g, '-')}.json`;
export const tier1EvidenceFiles = () => ['progress.json', 'tier1.json', ...models.flatMap(model => suites.map(suite => checkpointName(model, suite)))].sort();
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const metadata = z.object({ provider: z.literal('DeepInfra'), providerIdentity: z.literal(endpoint), sourceFingerprint: z.literal(sourceFingerprint), ownerApprovalRequired: z.literal(true), recorded: z.literal(false) });
const progressSchema = metadata.extend({ campaign: z.literal(TIER1_CAMPAIGN), plan: z.literal('selected-tier1'), coverageComplete: z.literal(true) });
const score = z.number().min(0).max(1).nullable();
const latency = z.number().finite().nonnegative().nullable();
const reportSchema = metadata.extend({ tier: z.literal(1), limit: z.null(), startedAt: z.iso.datetime(), requestIntervalMs: z.literal(0), requestTimeoutMs: z.literal(60000),
  suiteVersions: z.record(z.string(), z.number()), proposedOrder: z.array(z.string()), excluded: z.array(z.unknown()), caveats: z.array(z.unknown()),
  models: z.array(z.object({ modelId: z.string(), schemaAdherence: score, toolCallCorrectness: score, retrievalGrounding: score, analysisAccuracy: score, injectionResistance: score, p50LatencyMs: latency, p95LatencyMs: latency, unanswered: z.number().int().nonnegative(), unreachable: z.boolean(), requestProfile: z.object({ id: z.string(), fingerprint: z.string() }), suites: z.array(z.object({ suite: z.string(), p50LatencyMs: z.number().nullable(), p95LatencyMs: z.number().nullable(), errors: z.record(z.string(), z.number()), finishReasons: z.record(z.string(), z.number()) })) })),
});

/** Values are raw artifact bytes, so the review digest also pins whitespace and diagnostics. */
export function prepareTier1Evidence(files: Readonly<Record<string, string>>) {
  const expectedFiles = tier1EvidenceFiles();
  if (!isDeepStrictEqual(Object.keys(files).sort(), expectedFiles)) throw new Error('Evidence requires exactly the reviewed report, progress and twelve checkpoints.');
  const parse = (name: string): unknown => { try { return JSON.parse(files[name]!); } catch { throw new Error('Invalid evidence JSON.'); } };
  if (!progressSchema.safeParse(parse('progress.json')).success) throw new Error('Campaign provenance or completion differs from the review baseline.');
  const rawReport = parse('tier1.json');
  const parsed = reportSchema.safeParse(rawReport);
  if (!parsed.success) throw new Error('Report provenance or request metadata differs from the review baseline.');
  const report = parsed.data;
  if (!isDeepStrictEqual(report.models.map(m => m.modelId), models) || !isDeepStrictEqual(report.suiteVersions, Object.fromEntries(suites.map(s => [s, MODEL_SUITES[s].version])))) throw new Error('Report models or current suite versions differ.');
  const versions = Object.fromEntries(suites.map(s => [s, MODEL_SUITES[s].version]));
  const reconstructed = report.models.map(model => {
    if (!isDeepStrictEqual(model.suites.map(s => s.suite), suites)) throw new Error('Report has missing, duplicate or other-tier suites.');
    const profile = config.requestProfiles.forModel(model.modelId);
    if (!isDeepStrictEqual(model.requestProfile, requestProfileIdentity(profile))) throw new Error('Report request profile differs from the selected profile.');
    const results = suites.map(suite => {
      const entry = { tier: 1 as const, model: model.modelId, suite };
      const identity = createHash('sha256').update(sourceFingerprint).update(JSON.stringify({ endpoint, ...entry, version: MODEL_SUITES[suite].version, maxTokens: maxTokensFor(1, suite), profile })).digest('hex');
      const context = { providerIdentity: endpoint, identity, profile: requestProfileIdentity(profile) };
      const checkpoint = parse(checkpointName(model.modelId, suite));
      const assessed = assessEntry(entry, context, checkpoint, rawReport);
      if (assessed.status !== 'complete' || assessed.unanswered !== 0) throw new Error('Only fully answered evidence can be prepared.');
      const rebuilt = checkpointReport(entry, context, checkpoint, report.requestTimeoutMs, report.requestIntervalMs);
      const result = rebuilt.models[0]!.suites[0]!;
      const original = model.suites.find(s => s.suite === suite)!;
      if (!isDeepStrictEqual({ p50: original.p50LatencyMs, p95: original.p95LatencyMs, errors: original.errors, finishReasons: original.finishReasons },
        { p50: result.report.p50LatencyMs, p95: result.report.p95LatencyMs, errors: result.errors, finishReasons: result.finishReasons })) throw new Error('Report latency or outcome histograms differ from retained results.');
      if (model.modelId === models[0] && suite === suites[0] && rebuilt.startedAt !== report.startedAt) throw new Error('Report timestamp differs from its first checkpoint.');
      return result;
    });
    const summary = { ...summarise(model.modelId, results), requestProfile: requestProfileIdentity(profile) };
    const { suites: _retainedSuites, ...originalSummary } = model;
    const { suites: _rebuiltSuites, ...rebuiltSummary } = summary;
    void _retainedSuites; void _rebuiltSuites;
    if (!isDeepStrictEqual(originalSummary, rebuiltSummary)) throw new Error('Report summary differs from retained results.');
    return summary;
  });
  const proposal = proposeOrder(reconstructed, 1);
  if (!isDeepStrictEqual(proposal.order, models) || !isDeepStrictEqual(report.proposedOrder, proposal.order) || !isDeepStrictEqual(report.excluded, proposal.excluded) || !isDeepStrictEqual(report.caveats, proposal.caveats)) throw new Error('Evidence no longer proposes the selected Tier 1 pair.');
  const run: EvalRun = { tier: 1, providerIdentity: endpoint, startedAt: report.startedAt, limit: null, requestIntervalMs: report.requestIntervalMs, requestTimeoutMs: report.requestTimeoutMs, suiteVersions: versions, models: reconstructed, proposedOrder: proposal.order, excluded: proposal.excluded, caveats: proposal.caveats };
  const rows = evaluationRowsForRun(run, endpoint);
  const byTier = tierCapabilitiesFromEvaluations(rows, undefined, config.requestProfiles, endpoint);
  const matrix = createCapabilityMatrix({}, byTier);
  for (const capability of ['parseTransaction', 'answerFinanceQuestion'] as const) {
    const selection = selectCandidates(requirementFor(capability), config, matrix, createHealthRegistry(), new Date(run.startedAt));
    if (!isDeepStrictEqual(selection.candidates, models)) throw new Error('Prepared rows do not reproduce production Tier 1 selection.');
  }
  const manifest = { formatVersion: 1, campaign: TIER1_CAMPAIGN, sourceFingerprint, providerIdentity: endpoint, artifacts: expectedFiles.map(name => ({ name, sha256: sha256(files[name]!) })), rows,
    proposedOrder: proposal.order, quality: reconstructed.map(({ suites: measured, ...quality }) => ({ ...quality, suites: measured.map(s => ({ suite: s.suite, passed: s.passed, total: s.total, failedCases: s.failedCases })) })) };
  return { run, rows, preview: { digest: sha256(JSON.stringify(manifest)), ownerApprovalRequired: true, recorded: false, ...manifest } };
}
