/**
 * Compare inference hosts for the selected Tier 1 lineup (OD-24). Sends no
 * inference request and spends nothing: it reads OpenRouter's public listing
 * of every upstream host's price, precision and feature support, and prices the
 * token workload actually measured in the latest Tier 1 campaign.
 *
 *   npm run ai:hosts                 # Markdown to stdout
 *   npm run ai:hosts -- --out FILE   # also write it to FILE
 *
 * A host listed here is not a measured host. Moving to one still needs the
 * Tier 1 suites run there, because capability evidence is bound to the endpoint.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { INFERENCE_HOST_URLS } from '../src/lib/inference-hosts';
import { resolveModelConfig } from '../src/server/ai/config/models';
import { wireModelId } from '../src/server/ai/config/hosts';

const WORKLOAD = 'eval/reports/deepinfra-2026-11-07-tier1-parse-v4-2026-11-08/usage.json';
const LOW_PRECISION = /^(fp4|nvfp4|mxfp4|int4)$/i;

interface Workload { requests: number; promptTokens: number; completionTokens: number; }
interface Endpoint {
  provider_name: string; quantization?: string | null; uptime_last_1d?: number | null;
  supported_parameters?: string[]; pricing: { prompt: string; completion: string; input_cache_read?: string };
}

async function workload(): Promise<Map<string, Workload>> {
  const events = (JSON.parse(await readFile(WORKLOAD, 'utf8')) as {
    events: { model: string; promptTokens?: number; completionTokens?: number }[];
  }).events;
  const byModel = new Map<string, Workload>();
  for (const e of events) {
    const w = byModel.get(e.model) ?? { requests: 0, promptTokens: 0, completionTokens: 0 };
    w.requests += 1; w.promptTokens += e.promptTokens ?? 0; w.completionTokens += e.completionTokens ?? 0;
    byModel.set(e.model, w);
  }
  return byModel;
}

const perMillion = (raw: string | undefined) => (raw === undefined ? null : Number(raw) * 1e6);
const usd = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;

async function main(): Promise<void> {
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex === -1 ? null : process.argv[outIndex + 1];
  const lineup = resolveModelConfig().candidates(1);
  const measured = await workload();
  const lines: string[] = [
    `# Inference hosts for the Tier 1 lineup — ${new Date().toISOString().slice(0, 10)}`,
    '',
    `Workload: the token counts measured in \`${WORKLOAD}\` (one full Tier 1 campaign).`,
    'Prices: OpenRouter\'s public listing of each upstream host, per million tokens. Only hosts offering both tool calling and structured output are listed: Tier 1 needs both.',
    'Low precision (fp4/int4) is flagged because it can lower accuracy; a listing is not a measurement.',
  ];

  for (const model of lineup) {
    const w = measured.get(model);
    const slug = wireModelId(INFERENCE_HOST_URLS.openrouter, model);
    const response = await fetch(`https://openrouter.ai/api/v1/models/${slug}/endpoints`);
    if (!response.ok) { lines.push('', `## ${model}`, '', `Listing unavailable (HTTP ${response.status}).`); continue; }
    const endpoints = ((await response.json()) as { data?: { endpoints?: Endpoint[] } }).data?.endpoints ?? [];
    const usable = endpoints.filter((e) => e.supported_parameters?.includes('tools') && e.supported_parameters.includes('structured_outputs'));
    const rows = usable.map((e) => {
      const input = perMillion(e.pricing.prompt)!; const output = perMillion(e.pricing.completion)!;
      const campaign = w ? (w.promptTokens * input + w.completionTokens * output) / 1e6 : null;
      const per1k = w ? (campaign! / w.requests) * 1000 : null;
      return { e, input, output, cached: perMillion(e.pricing.input_cache_read), campaign, per1k };
    }).sort((a, b) => (a.campaign ?? a.input) - (b.campaign ?? b.input));

    lines.push('', `## ${model}`, '');
    lines.push(w
      ? `Measured: ${w.requests} requests, ${w.promptTokens.toLocaleString('en')} input and ${w.completionTokens.toLocaleString('en')} output tokens (${Math.round((100 * w.promptTokens) / (w.promptTokens + w.completionTokens))}% input).`
      : 'No measured workload for this model.');
    lines.push('', '| Host | Precision | Uptime 1d | In $/M | Cached in $/M | Out $/M | Campaign | Per 1,000 requests |', '|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const q = r.e.quantization ?? 'unknown';
      lines.push(`| ${r.e.provider_name} | ${q}${LOW_PRECISION.test(q) ? ' ⚠' : ''} | ${r.e.uptime_last_1d == null ? '—' : `${Math.round(r.e.uptime_last_1d)}%`} | ${r.input.toFixed(3)} | ${r.cached === null ? '—' : r.cached.toFixed(3)} | ${r.output.toFixed(3)} | ${r.campaign === null ? '—' : usd(r.campaign)} | ${r.per1k === null ? '—' : usd(r.per1k)} |`);
    }
    if (usable.length < endpoints.length) lines.push('', `${endpoints.length - usable.length} further host(s) omitted: no tool calling or no structured output.`);
  }

  const text = `${lines.join('\n')}\n`;
  process.stdout.write(text);
  if (out) await writeFile(out, text);
}

main().catch((error: unknown) => {
  console.error(`ai:hosts failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
