export type PolicySeverity = 'error' | 'warning';
export type EvaluatorType = 'regex' | 'command' | 'none';

export interface PolicyEvaluator {
  type: EvaluatorType;
  pattern?: string;
  flags?: string;
}

export interface Policy {
  id: string;
  rule: string;
  skill: string;
  evaluator: PolicyEvaluator;
  fix_suggestion: string;
  severity: PolicySeverity;
}

export interface PolicyRole {
  role: string;
  displayName: string;
  inheritsFrom?: string;
  policies: Policy[];
}

export interface PolicyConfig {
  hierarchy: PolicyRole[];
  currentUserRole: string;
}

export interface ResolvedPolicy extends Policy {
  setByRole: string;
  setByDisplayName: string;
}
