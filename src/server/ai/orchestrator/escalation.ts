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
 * deliberately narrow: a comparison word escalates only with a period in it
 * ("SBI vs HDFC" is one balance call), and "health" escalates only as
 * "financial health" (the Health spending category is a plain sum).
 */

export type EscalationTier = 1 | 2;

export type EscalationReason =
  | 'routine'
  | 'review_or_analysis'
  | 'multi_period_comparison'
  | 'scenario'
  | 'why_or_change'
  | 'dependent_follow_up';

export interface EscalationDecision {
  readonly tier: EscalationTier;
  readonly reason: EscalationReason;
}

export interface PreviousTurn {
  /** The tier the previous user message was served on. */
  readonly tier: EscalationTier;
}

const PERIOD =
  /\b(month|months|monthly|year|years|yearly|annual|quarter|quarters|week|weeks|period|periods|last|previous|prior|ago|ytd|today|yesterday|january|february|march|april|may|june|july|august|september|october|november|december|20\d\d)\b/;

const TRIGGERS: readonly (readonly [Exclude<EscalationReason, 'routine' | 'dependent_follow_up'>, (m: string) => boolean])[] = [
  [
    'review_or_analysis',
    (m) =>
      /\b(review|analy[sz]e|analysis|assess|assessment|evaluate|evaluation|audit|deep dive|investigat\w*|patterns?|insights?|pay attention to|financial health|overall picture|risks?)\b/.test(
        m,
      ),
  ],
  [
    'scenario',
    (m) =>
      /\b(what if|suppose|supposing|scenario|scenarios|hypothetical\w*|can i afford|could i afford|reasonably|should i)\b/.test(m) ||
      // "if I invest …", not "how much did I spend if I leave out rent".
      /\bif i (invest|put|add|increase|raise|reduce|cut|stop|pay off|prepay|buy|sell|save|move|keep|continue|start)\b/.test(m),
  ],
  [
    'why_or_change',
    (m) =>
      /\bwhy\b/.test(m) ||
      /\b(what caused|what drove|driving|drove|underperform\w*|outperform\w*)\b/.test(m) ||
      /\bhow (has|have|did)\b.*\b(change|changed|grow|grown|evolve|evolved|shift|shifted|move|moved)\b/.test(m),
  ],
  [
    'multi_period_comparison',
    (m) =>
      /\b(month|year|quarter|week)[- ]on[- ]\1\b|\b(month|year|quarter|week)[- ]over[- ](month|year|quarter|week)\b/.test(m) ||
      /\btrends?\b|\btrending\b/.test(m) ||
      (/\b(compare|compared|comparing|comparison|versus|vs)\b/.test(m) && PERIOD.test(m)) ||
      // "more than last month", not "expenses more than ₹5,000 last month".
      /\bthan (last|the last|previous|the previous|prior|in|during|before)\b/.test(m),
  ],
];

/**
 * Openings that make a message meaningless on its own. Checked only on short
 * messages: a long message that happens to start with "and" carries its own
 * subject and is classified on its own words.
 */
const DEPENDENT_OPENING =
  /^(and|but|what about|how about|same for|same thing for|now for|then|why|break (that|it|this) down|tell me more|more detail|more details|go deeper|elaborate|explain (that|this|it)|and why)\b/;
const DEPENDENT_MAX_WORDS = 7;

function normalise(message: string): string {
  return message.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}

function isDependentFollowUp(m: string): boolean {
  const words = m.split(' ').filter(Boolean).length;
  return words <= DEPENDENT_MAX_WORDS && DEPENDENT_OPENING.test(m);
}

/** The tier one user message should be served on. */
export function classifyEscalation(message: string, previous?: PreviousTurn): EscalationDecision {
  const m = normalise(message);

  const triggered = TRIGGERS.find(([, test]) => test(m));
  if (triggered) return { tier: 2, reason: triggered[0] };

  if (previous && isDependentFollowUp(m)) {
    return { tier: previous.tier, reason: previous.tier === 2 ? 'dependent_follow_up' : 'routine' };
  }

  return { tier: 1, reason: 'routine' };
}
