export type MembershipRole = 'ORG_ADMIN' | 'POLICY_ADMIN' | 'MEMBER';
export type PolicySeverity = 'ERROR' | 'WARNING';
// SHADOW: evaluated + audit-logged, never blocks. Rollout mode for new policies.
export type PolicyStatus = 'ENFORCED' | 'SHADOW';

export interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  workosUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  memberships?: Membership[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  autoFix?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  id: string;
  orgId: string;
  userId: string;
  role: MembershipRole;
  createdAt: string;
  updatedAt: string;
  org: Organization;
  user?: User;
  assignedRoles?: Role[];
}

export interface Role {
  id: string;
  orgId: string;
  name: string;
  displayName: string;
  inheritsFromId: string | null;
  createdAt: string;
  updatedAt: string;
  bindings?: PolicyBinding[];
}

export interface Policy {
  id: string;
  orgId: string;
  name: string;
  rule: string;
  skill: string;
  evaluatorType: string;
  evaluatorPattern: string | null;
  evaluatorFlags: string | null;
  fixSuggestion: string;
  severity: PolicySeverity;
  status: PolicyStatus;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  bindings?: PolicyBinding[];
}

export interface PolicyBinding {
  id: string;
  roleId: string;
  policyId: string;
  createdAt: string;
  role?: Role;
  policy?: Policy;
}

export interface ApiKey {
  id: string;
  orgId: string;
  createdById: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  orgId: string;
  actorId: string | null;
  action: string;
  resource: string | null;
  metadata: any | null;
  createdAt: string;
  actor?: User | null;
}

// Inputs
export interface SignupInput {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  orgName: string;
  orgSlug: string;
}

export interface LoginInput {
  email: string;
  password?: string;
}

export interface CreateRoleInput {
  name: string;
  displayName: string;
  inheritsFromId?: string;
}

export interface UpdateRoleInput {
  displayName?: string;
  inheritsFromId?: string | null;
}

export interface CreatePolicyInput {
  name: string;
  rule: string;
  skill?: string;
  evaluatorType: 'regex' | 'command' | 'none';
  evaluatorPattern?: string;
  evaluatorFlags?: string;
  fixSuggestion?: string;
  severity: PolicySeverity;
  status?: PolicyStatus;
  roleIds?: string[];
}

export interface UpdatePolicyInput extends Omit<Partial<CreatePolicyInput>, 'evaluatorPattern' | 'evaluatorFlags'> {
  evaluatorPattern?: string | null;
  evaluatorFlags?: string | null;
}

export interface InviteMemberInput {
  email: string;
  membershipRole: MembershipRole;
  assignedRoleId?: string;       // legacy single-role
  assignedRoleIds?: string[];
}

export interface UpdateMemberInput {
  membershipRole?: MembershipRole;
  assignedRoleId?: string | null; // legacy single-role
  assignedRoleIds?: string[];
}

export interface CreateApiKeyInput {
  name: string;
  scopes?: string[];
  expiresAt?: string;
}

export interface OrgStats {
  violationsByDay: { day: string; count: number }[];
  topPolicies: { policyId: string; name: string; count: number }[];
  evaluationsThisMonth: number;
  lastCheckAt: string | null;
  lastCheckKeyName: string | null;
}

export interface TestPolicyResult {
  valid: boolean;
  matched: boolean;
  matchedText: string | null;
  line: number | null;
  error?: string;
}

// Responses
export interface AuthResponse {
  token: string;
  user: User;
  org?: Organization;
}

export interface MeResponse {
  user: User;
}

export interface SsoConfig {
  id: string;
  provider: string;
  workosOrgId?: string;
  connectionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyVersion {
  id: string;
  policyId: string;
  version: number;
  name: string;
  rule: string;
  skill: string;
  evaluatorType: string;
  evaluatorPattern: string | null;
  evaluatorFlags: string | null;
  fixSuggestion: string;
  severity: PolicySeverity;
  changedById: string | null;
  changedBy?: { id: string; email: string; firstName?: string; lastName?: string } | null;
  createdAt: string;
}
