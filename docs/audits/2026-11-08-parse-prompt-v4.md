# Missing-amount prompt clarification and parse-v4 evidence — 8 November 2026

Implementation `dcde44e` continues the measured [v3 failure investigation](../../eval/reports/deepinfra-2026-11-08-tier1-v3-failures/README.md). GPT-OSS twice returned high confidence and no ambiguity warning for an omitted amount. The frozen corpus already requires null amount, confidence below high and a nonempty warning for that input.

The shared production prompt now says that an omitted amount makes the draft incomplete even if its kind/date/account are clear: confidence must be medium or low and ambiguities must explain that the amount is missing. The same prompt serves every model and evaluation case. Parse advances **v3 → v4**. No case, expected value, scorer, output schema, budget, model order, request profile or routing gate changes. In particular, the competing-amount expectation remains unchanged and its product-policy decision stays open.

## Fresh evidence

The new named campaign `tier1-parse-v4-2026-11-08` answered all 380 cases for the selected GLM-5.3-Flash → GPT-OSS-120B pair using `--selected-tier1 --run --no-record`. Source fingerprint: `bfc6accec0ebf384b5f04372fa67771ae4502ea99a42e3a7f1b3c5b1978b727d`. The conservative fresh-run reservation estimate is US$1.444, within the unchanged project/account caps; actual spend is accounted per response or conservatively reserved when usage is unknown. No scored answer is retried.

The changed prompt makes earlier parse-v3 evidence stale. Historical reports and the v3 import manifest remain byte-identical. Evidence preparation is retargeted only to the fresh named v4 source; its existing completeness/provenance/current-version checks and production selection requirements remain unchanged. The [separate v4 preview](2026-11-08-tier1-parse-v4-evidence-preview.json) reconstructs twelve rows from complete eligible evidence, with digest `0b576c87529b09d01ac1411a5fb9974359f0f7787fa265155d5f62c27d591e9b`. Both models pass the unchanged schema/tool gates and production selection remains GLM → GPT-OSS. Deployment recording and generation remain off.

## Verification and remaining decisions

The two missing-amount expectations accept medium or low confidence with an ambiguity and reject high confidence or a missing warning, unchanged from v3. Every parse case uses the shared clarification. 231 focused unit checks, typecheck and lint pass, including actual v3 report rejection. Fresh results are schema 100/100 each, tools 54/57 vs 53/57, parsing 38/40 vs 33/40, grounding 22/25 vs 21/25, robustness 7/10 vs 6/10 and injection 24/25 vs 21/25. Both models pass the two missing-amount cases. The exact fallback parse score is unchanged despite a different failure set; remaining field/injection failures stay visible. All 130 parse/injection responses have output-free diagnostics. A fetch-denied completed resume preserves all twelve checkpoints and the usage ledger byte-identically. The 132 fresh-evidence/import checks pass, including stale actual v3 rejection and unchanged archived v3 preview. Three full-suite test version pins needed v4 updates. **2,583 unit, 65 property and 674 PostgreSQL 17 integration tests pass (3,322 total)**, plus typecheck, lint, production build, client-secret scan and integrity **35 passing, 0 failing**. PostgreSQL 18 remains the follow-up PR's CI check; parent #66 is already green on both versions.

The null-versus-candidate policy for competing unconfirmed amounts, remaining field/injection/grounding/robustness failures, unselected tiers and OD-18 remain outstanding. A parsing clarification does not resolve those issues or authorize recording/activation.

## Accounting and review status

The 380 events account for US$0.071546806. Project accounted spending is US$2.005912455 of US$10, leaving US$7.994087545; no budget setting changed. The prior full campaign and v3 preview remain byte-identical. The v4 preview is prepared for review, with no deployment recording or generation activation. Final review/verification update: 9 November 2026 (Asia/Calcutta).

## Current operator commands, pending approval

The current preview is read-only:

```sh
npm run --silent ai:evidence:tier1 -- --preview
```

Only after owner acceptance of the quality limitations and explicit evidence-write approval, with matching deployment provider/order/profiles, the prepared write command is:

```sh
npm run ai:evidence:tier1 -- --record --expect-sha256 0b576c87529b09d01ac1411a5fb9974359f0f7787fa265155d5f62c27d591e9b
```

This write mode has not been run against deployment. Its normal encoder, atomic/idempotent transaction, conflict refusal and generation hold are unchanged. Earlier v3 command/digest documentation is historical and cannot authorize the new v4 rows. Positive import tests use only the disposable test database.
