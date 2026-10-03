/** Shared producer/validator budgets. Private resident history is not truncated. */
export const CONTEXT_LIMITS = {knownTargets:128, observations:128, memories:128} as const;
