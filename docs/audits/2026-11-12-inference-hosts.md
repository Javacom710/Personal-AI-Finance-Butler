# Inference hosts for the Tier 1 lineup — 2026-11-12

Workload: the token counts measured in `eval/reports/deepinfra-2026-11-07-tier1-parse-v4-2026-11-08/usage.json` (one full Tier 1 campaign).
Prices: OpenRouter's public listing of each upstream host, per million tokens. Only hosts offering both tool calling and structured output are listed: Tier 1 needs both.
Low precision (fp4/int4) is flagged because it can lower accuracy; a listing is not a measurement.

## zai-org/GLM-5.3-Flash

Measured: 190 requests, 333,764 input and 13,805 output tokens (96% input).

| Host | Precision | Uptime 1d | In $/M | Cached in $/M | Out $/M | Campaign | Per 1,000 requests |
|---|---|---|---|---|---|---|---|
| Wafer | nvfp4 ⚠ | 100% | 0.042 | 0.041 | 0.184 | $0.017 | $0.087 |
| PrimeIntellect | unknown | 100% | 0.052 | 0.010 | 0.250 | $0.021 | $0.110 |
| OpenInference | fp4 ⚠ | 99% | 0.060 | 0.030 | 0.300 | $0.024 | $0.127 |
| Darkbloom | fp4 ⚠ | 97% | 0.065 | 0.012 | 0.180 | $0.024 | $0.127 |
| Wafer | nvfp4 ⚠ | 100% | 0.065 | 0.064 | 0.240 | $0.025 | $0.132 |
| Tenstorrent | fp8 | 100% | 0.075 | 0.015 | 0.250 | $0.028 | $0.150 |
| Novita | fp8 | 100% | 0.084 | 0.017 | 0.280 | $0.032 | $0.168 |
| Near AI | fp8 | 100% | 0.080 | 0.012 | 0.500 | $0.034 | $0.177 |
| StreamLake | fp8 | 98% | 0.089 | 0.018 | 0.295 | $0.034 | $0.177 |
| DekaLLM | unknown | 98% | 0.100 | 0.030 | 0.500 | $0.040 | $0.212 |
| Morph | fp8 | 97% | 0.116 | 0.050 | 0.122 | $0.040 | $0.213 |
| InferenceNet | fp4 ⚠ | 100% | 0.108 | 0.035 | 0.350 | $0.041 | $0.215 |
| InferenceNet | fp4 ⚠ | 100% | 0.108 | 0.035 | 0.350 | $0.041 | $0.215 |
| DigitalOcean | unknown | 100% | 0.112 | 0.030 | 0.375 | $0.043 | $0.225 |
| Reka | unknown | 100% | 0.120 | 0.030 | 0.300 | $0.044 | $0.233 |
| CoreWeave | nvfp4 ⚠ | 73% | 0.120 | 0.020 | 0.380 | $0.045 | $0.238 |
| NextBit | fp4 ⚠ | 100% | 0.120 | 0.030 | 0.450 | $0.046 | $0.243 |
| Makora | fp4 ⚠ | 98% | 0.140 | 0.030 | 0.240 | $0.050 | $0.263 |
| Particle AI | nvfp4 ⚠ | 99% | 0.130 | 0.040 | 0.500 | $0.050 | $0.265 |
| Mistral | unknown | 100% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| KT | unknown | 100% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| Cohere | nvfp4 ⚠ | 100% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| Nebius | fp4 ⚠ | 99% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| Modal | fp4 ⚠ | 100% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| BaseTen | fp8 | 0% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| Crusoe | fp4 ⚠ | 100% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| Fireworks | unknown | 100% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| Friendli | unknown | 100% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| Together | unknown | 100% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| Parasail | fp4 ⚠ | 100% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| BaseTen | fp8 | 98% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| Venice | unknown | 100% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| DeepInfra | fp4 ⚠ | 100% | 0.150 | 0.030 | 0.500 | $0.057 | $0.300 |
| Inceptron | fp8 | 100% | 0.175 | 0.040 | 0.470 | $0.065 | $0.342 |
| Sail Research | fp4 ⚠ | 100% | 0.175 | 0.022 | 0.625 | $0.067 | $0.353 |
| Sail Research | fp4 ⚠ | 100% | 0.175 | 0.022 | 0.625 | $0.067 | $0.353 |
| Parasail | fp4 ⚠ | 100% | 0.188 | 0.037 | 0.625 | $0.071 | $0.375 |

5 further host(s) omitted: no tool calling or no structured output.

## openai/gpt-oss-120b

Measured: 190 requests, 188,268 input and 44,787 output tokens (81% input).

| Host | Precision | Uptime 1d | In $/M | Cached in $/M | Out $/M | Campaign | Per 1,000 requests |
|---|---|---|---|---|---|---|---|
| Io Net | fp4 ⚠ | 90% | 0.030 | 0.015 | 0.150 | $0.012 | $0.065 |
| Near AI | fp4 ⚠ | 100% | 0.030 | 0.015 | 0.150 | $0.012 | $0.065 |
| CoreWeave | fp4 ⚠ | 99% | 0.030 | 0.030 | 0.170 | $0.013 | $0.070 |
| DekaLLM | bf16 | 97% | 0.030 | 0.030 | 0.180 | $0.014 | $0.072 |
| PrimeIntellect | fp4 ⚠ | 100% | 0.049 | 0.044 | 0.105 | $0.014 | $0.073 |
| AkashML | fp4 ⚠ | 100% | 0.030 | 0.030 | 0.187 | $0.014 | $0.074 |
| DeepInfra | bf16 | 100% | 0.037 | — | 0.170 | $0.015 | $0.077 |
| Crusoe | bf16 | 100% | 0.050 | 0.050 | 0.250 | $0.021 | $0.108 |
| Mancer 2 | fp8 | 100% | 0.055 | 0.055 | 0.250 | $0.022 | $0.113 |
| Sail Research | fp4 ⚠ | 100% | 0.060 | 0.030 | 0.400 | $0.029 | $0.154 |
| BaseTen | fp4 ⚠ | 99% | 0.100 | 0.100 | 0.500 | $0.041 | $0.217 |
| BaseTen | fp4 ⚠ | 97% | 0.100 | 0.100 | 0.500 | $0.041 | $0.217 |
| Parasail | fp4 ⚠ | 100% | 0.100 | 0.055 | 0.750 | $0.052 | $0.276 |
| Nebius | fp4 ⚠ | 100% | 0.150 | 0.100 | 0.600 | $0.055 | $0.290 |
| Together | unknown | 99% | 0.150 | — | 0.600 | $0.055 | $0.290 |
| Groq | unknown | 100% | 0.150 | 0.075 | 0.600 | $0.055 | $0.290 |
| Parasail | fp4 ⚠ | 100% | 0.150 | — | 0.750 | $0.062 | $0.325 |
| Cerebras | fp16 | 100% | 0.350 | 0.350 | 0.750 | $0.099 | $0.524 |

8 further host(s) omitted: no tool calling or no structured output.
