import 'server-only';

/**
 * The Tier 1 → Tier 2 escalation classifier
 * ([AI-SYSTEM.md §6.2–6.4](../../../../docs/AI-SYSTEM.md)).
 *
 * Deterministic application code, not a model: the same message always gets
 * the same tier, so the `routing` eval suite can check it exactly.
 *
 * **It can only choose between Tier 1 and Tier 2.** Tier 3 needs an explicit
 * user action (the orchestrator's `explicitUserRequest`), and no wording
 * reaches it. Both tiers get the same read-only tool set, so a message that
 * talks its way into Tier 2 gets a costlier model, never a more permissive
 * path (`SECURITY.md` §8). The cost of that is bounded by the daily budget.
 *
 * **Escalation is per message, never sticky.** A previous Tier 2 turn carries
 * forward only to a *dependent follow-up*, a message that cannot be understood
 * without the previous answer ("why?", "and last year?", "break that down").
 * A fresh, self-contained question starts again at Tier 1.
 *
 * The rule of thumb (§6.4): if a single tool call answers the question, it is
 * Tier 1. Over-escalation is the failure to guard against, because it is
 * invisible in the answers and shows up only in the bill. So the triggers are
 * deliberately narrow: a comparison escalates only when it compares periods
 * ("SBI vs HDFC today" is one balance call), and "health" escalates only as
 * "financial health" (the Health spending category is a plain sum).
 */

export type EscalationTier = 1 | 2;

export type EscalationReason =
  | 'routine'
  | 'review_or_analysis'
  | 'multi_period_comparison'
  | 'scenario'
  | 'why_or_change'
  | 'cross_domain'
  | 'dependent_follow_up';

export interface EscalationDecision {
  readonly tier: EscalationTier;
  readonly reason: EscalationReason;
  /**
   * Present when the message told the assistant which model or tier to use.
   * The user does not choose the model (owner's ruling, 2026-10-31, ADR-48):
   * the instruction is removed before classifying and has no effect on the
   * tier, and the assistant tells the user it was not followed.
   */
  readonly modelChoiceIgnored?: true;
}

export interface PreviousTurn {
  /** The tier the previous user message was served on. */
  readonly tier: EscalationTier;
}

/**
 * The financial domains a message names. A relational phrase escalates only
 * across two of them: "cash relative to upcoming obligations" weighs two tool
 * results, "food relative to total expenses" is one expense summary.
 */
const DOMAINS: readonly RegExp[] = [
  // cash and balances ("enough" asks whether the cash is there)
  /\b(cash|balances?|savings|bank|accounts?|liquid|wallets?|enough)\b/,
  // obligations
  /\b(obligations?|bills?|emis?|loans?|rent|recurring|subscriptions?|commitments?|dues|liabilit(y|ies)|debts?|credit cards?)\b/,
  // spending and income
  /\b(spend|spending|spent|expenses?|income|salary|cash flow|savings rate)\b/,
  // investments
  /\b(invest|investing|investments?|portfolio|holdings?|sips?|stocks?|mutual funds?|allocation)\b/,
  // net worth and other assets
  /\b(net worth|assets?|property|gold)\b/,
];

function domainsIn(m: string): number {
  return DOMAINS.filter((domain) => domain.test(m)).length;
}

/** One reference to a period: "this month", "last year", "today", "August", "2026-08", "Q2", "2025", "two months ago". */
const PERIOD_REF =
  /\b(this|last|previous|prior|next|same) (week|month|quarter|year|period)\b|\b(today|yesterday|ytd)\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b|\b20\d\d-(0[1-9]|1[0-2])\b|\b20\d\d\b|\bq[1-4]\b|\b\w+ (weeks?|months?|quarters?|years?) ago\b/g;

/** A comparison whose other side is a period: "with last month", "vs the previous year". */
const AGAINST_PERIOD =
  /\b(with|to|against|vs|versus) (the )?(last|previous|prior|same) (week|month|quarter|year|period)\b/;

/**
 * Is a comparison between periods, rather than between accounts or categories
 * within one period? "Compare food and transport last month" names one period
 * and is a single breakdown; "compare this month with last month" names two.
 */
function comparesPeriods(m: string): boolean {
  if (AGAINST_PERIOD.test(m)) return true;
  return new Set(m.match(PERIOD_REF) ?? []).size >= 2;
}

const TRIGGERS: readonly (readonly [Exclude<EscalationReason, 'routine' | 'dependent_follow_up'>, (m: string) => boolean])[] = [
  [
    'review_or_analysis',
    (m) =>
      /\b(review|analy[sz]e|analysis|assess|assessment|evaluate|evaluation|audit (my|of my)|deep dive|investigat\w*|patterns?|insights?|pay attention to|financial health|overall picture|risks?)\b/.test(
        m,
      ),
  ],
  [
    'scenario',
    (m) =>
      /\b(what if|suppose|supposing|scenario|scenarios|hypothetical\w*|can i afford|could i afford|reasonably|should i)\b/.test(m) ||
      // "if I invest …", not "how much did I spend if I leave out rent".
      /\bif i (invest|put|add|increase|raise|reduce|cut|stop|pay off|prepay|buy|sell|save|move|keep|continue|start)\b/.test(m) ||
      // Any condition with a consequence: "if I lose my job, how long will…",
      // "what would … be if gold rises". A filter ("… if I leave out rent?") has none.
      /\bif\b[^?]*\b(will|would|how long)\b|\b(will|would)\b[^?]*\bif\b/.test(m),
  ],
  [
    'why_or_change',
    (m) =>
      // "Why" about the user's own figures; "why is diversification important?"
      // is a concept question and stays Tier 1.
      /\bwhy\b.*\b(my|i|i'm|i've|me|our|we)\b/.test(m) ||
      // Causal wording only in a causal construction: "driving lessons" is an expense.
      /\b(what('s| is| was)? (caused|causing|drove|driving)|what led to|(caused|drove|driving) (the|my|this|that) (increase|decrease|rise|fall|drop|jump|change|growth|decline|spike)|underperform\w*|outperform\w*)\b/.test(m) ||
      /\bhow (has|have|did)\b.*\b(change|changed|grow|grown|evolve|evolved|shift|shifted|move|moved)\b/.test(m),
  ],
  [
    // One domain weighed against another: cash against obligations, savings
    // against bills. "How much of my net worth is invested?" is not this: one
    // net-worth result carries both figures.
    'cross_domain',
    (m) =>
      /\b(relative to|in relation to|enough to cover|enough for|cover my|before (considering|investing|i invest)|based on my|given my)\b/.test(m) &&
      domainsIn(m) >= 2,
  ],
  [
    'multi_period_comparison',
    (m) =>
      /\b(month|year|quarter|week)[- ]on[- ]\1\b|\b(month|year|quarter|week)[- ]over[- ](month|year|quarter|week)\b/.test(m) ||
      /\btrends?\b|\btrending\b/.test(m) ||
      (/\b(compare|compared|comparing|comparison|versus|vs)\b/.test(m) && comparesPeriods(m)) ||
      // "more than last month", not "expenses more than ₹5,000 last month".
      /\bthan (last|the last|previous|the previous|prior|in|during|before)\b/.test(m),
  ],
];

/**
 * A dependent follow-up is short and cannot be understood without the previous
 * answer. Openings that point back at it ("what about", "break that down")
 * make a message dependent. A leading conjunction ("and", "but") does only when
 * what follows is not a complete question of its own: "and last year?" is
 * dependent, "and what is my HDFC balance?" is not. A long message carries its
 * own subject and is classified on its own words.
 */
const POINTS_BACK =
  /^(what about|how about|same for|same thing for|now for|break (that|it|this) down|tell me more|more details?|go deeper|elaborate|explain (that|this|it))\b/;
const CONJUNCTION = /^(and|but|then|so|also)\b,? ?/;
const QUESTION_FRAME = /^(what is|what's|what are|what was|what were|how much|how many|which|show|list|tell me|give me)\b/;
/** A word that needs the previous answer. "This month" is a period, not a reference back. */
const REFERS_BACK = /\b(that|it|those|these|them)\b|\bthis\b(?! (week|month|quarter|year))/;
const DEPENDENT_MAX_WORDS = 7;
/**
 * A bare "why?" asks about the previous answer and has no subject of its own.
 * "Why did my spending go up?" has one, and is classified on its own words.
 */
const BARE_WHY = /^(?:(?:and|but|so),? )?why(?: (?:is|was|did|does) (?:that|it|this)(?: happen)?| so| not)?[?.!]*$/;

function normalise(message: string): string {
  return message.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}

function isDependentFollowUp(m: string): boolean {
  if (m.split(' ').filter(Boolean).length > DEPENDENT_MAX_WORDS) return false;
  if (BARE_WHY.test(m) || POINTS_BACK.test(m)) return true;
  const conjunction = CONJUNCTION.exec(m);
  if (!conjunction) return false;
  const rest = m.slice(conjunction[0].length);
  if (POINTS_BACK.test(rest)) return true;
  // A complete question after "and"/"but" stands on its own.
  return !(QUESTION_FRAME.test(rest) && !REFERS_BACK.test(rest));
}

/** What a follow-up adds beyond the words that point back at the previous answer. */
function withoutOpening(m: string): string {
  if (BARE_WHY.test(m)) return '';
  const rest = m.slice(CONJUNCTION.exec(m)?.[0].length ?? 0);
  return rest.replace(POINTS_BACK, '').trim();
}

/** The tier one user message should be served on. */
/** The names a user might ask for: a model, an LLM, a tier, a model family. */
const MODEL_NOUN =
  "(model|models|llm|llms|tier ?[1-5]|gpt[\\w.-]*|deepseek[\\w.-]*|nemotron[\\w.-]*|qwen[\\w.-]*|gemma[\\w.-]*|glm[\\w.-]*|mistral[\\w.-]*|llama[\\w.-]*|claude)";
/**
 * An instruction choosing the model: "use 'x' llm model", "switch to Tier 3
 * and", "using deepseek". It is the instruction that is removed, not the
 * question around it.
 */
const MODEL_CHOICE = new RegExp(
  `\\b(?:please )?(?:use|using|switch to|switch|run (?:it |this )?(?:on|with)|via|pick|choose|select|try|answer with)\\b[^,.;!?]*?\\b${MODEL_NOUN}\\b(?: you have)?(?: and)?`,
  'g',
);

export function classifyEscalation(message: string, previous?: PreviousTurn): EscalationDecision {
  const raw = normalise(message);
  const m = raw.replace(MODEL_CHOICE, ' ').replace(/\s+/g, ' ').trim();
  const decision = classifyQuestion(m, previous);
  return m === raw ? decision : { ...decision, modelChoiceIgnored: true };
}

function classifyQuestion(m: string, previous?: PreviousTurn): EscalationDecision {
  // A dependent follow-up is resolved first: it inherits the previous tier,
  // unless what it adds is itself a trigger ("and how does that compare with
  // last year?"). So "why?" after a Tier 1 answer stays at Tier 1.
  if (previous && isDependentFollowUp(m)) {
    const own = TRIGGERS.find(([, test]) => test(withoutOpening(m)));
    if (own) return { tier: 2, reason: own[0] };
    return { tier: previous.tier, reason: previous.tier === 2 ? 'dependent_follow_up' : 'routine' };
  }

  const triggered = TRIGGERS.find(([, test]) => test(m));
  if (triggered) return { tier: 2, reason: triggered[0] };

  return { tier: 1, reason: 'routine' };
}
