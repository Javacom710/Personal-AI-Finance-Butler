# Tier 1 intent routing and authenticated action preparation — 8 November 2026

Continues CI-green PR #62 (`aeed58f`, PostgreSQL 17/18). This follow-up connects the existing classifier to saved questions and prepares the authenticated generation actions while retaining the release hold. No live inference, measurement recording or activation occurs.

## Intent routing

After validating the question, conversation identifier and ownership, `askConversation` classifies only the original user question. A dependent follow-up receives the previous assistant message's authoritative serving-tier column, not its interpretation, tool results, client fields or inferred prose. Fresh self-contained questions are independently classified and can return to Tier 1.

The existing classifier and its rules are unchanged. This composition is Tier 1 only: a question requiring Tier 2 returns an advanced-analysis-unavailable domain result before a read capability or provider request exists, with no saved partial exchange. It never falls back to a routine answer or reaches Tier 3 from question wording. Serving advanced requests later requires its own selected, measured and reviewed composition.

Saved question presentation computes the existing `modelChoiceIgnored` decision from the original question and shows a fixed application-routing notice. It does not trust model prose, store a new answer field, change exports or add a database/tool schema. Question and model text remain escaped by React.

## Prepared actions and release hold

Both generation actions authenticate first. The current code-only `isTier1GenerationReleased()` returns **false**, preserving the existing owner-review hold before context creation, intent lookup or composition. No setting, environment variable, form value or API key enables it. Generation controls remain disabled; there is no fake-provider endpoint or development bypass.

The prepared inactive branches obtain context from the authenticated session and call the owner-bound adapter. Form owner/model/tier/explicit-request fields are not forwarded. Existing service validation handles missing, malformed and unsupported arguments before a model request. Draft generation stages an unconfirmed proposal and returns to the existing draft-review list; it never invokes confirmation. A completed saved question redirects using the conversation identifier returned by the service, never an untrusted return URL. Revalidation affects only the corresponding metadata surfaces.

Positive-path tests mock the code-only hold inside the test process. Production has no way to select that test behavior. Every actual model turn and parsing repair continues through the runtime controls prepared in PR #62.

## Verification and remaining work

The focused unit run passes 163 checks, including the unchanged routing corpus, authentication/hold ordering, session ownership, trusted redirects, context/service failures, model-choice presentation and existing disabled controls. The focused PostgreSQL run passes 46 checks across saved conversations and real-runtime composition, with synthetic owners and fake HTTP responses. It covers unsupported-intent zero egress, authoritative history tiers, non-sticky escalation, model-prose isolation, test-only positive action paths, forged routing fields and malformed arguments.

The full regression passes **2,536 unit, 65 property and 661 PostgreSQL 17 integration tests (3,262 total)**. Typecheck, lint, production build, client-secret scan and integrity (35 passing, 0 failing) pass. An initial concurrent unit/DB/build run timed out the existing 60-second fake-campaign CLI test; all 2,536 unit checks pass with the jobs run serially, without changing the timeout or workload. Focused checks above repeat cases included in these totals. The normal CI matrix remains required. No provider/model strategy, prompt, scorer, evaluation version, threshold, financial schema, tool registry or global runtime limit changes here. Historical reports and project inference accounting remain unchanged at US$1.932521049 of US$10.

Active generation forms and owner review of the concrete release remain ahead. Accepting model quality, recording the qualified evidence, releasing the code-only hold and verifying live workflows are separate release steps. Advanced/vision tier choices, the scenario engine and the remaining phases stay outstanding.
