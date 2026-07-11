import {
  SignupInput, LoginInput, AuthResponse, MeResponse,
  Organization, Role, CreateRoleInput, UpdateRoleInput,
  Policy, CreatePolicyInput, UpdatePolicyInput,
  Membership, InviteMemberInput, UpdateMemberInput,
  ApiKey, CreateApiKeyInput, AuditLogEntry,
  SsoConfig, PolicyVersion
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('orgai_token') : null;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}/v1${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('orgai_token');
      document.cookie = 'orgai_has_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      window.location.href = '/login';
    }
    
    let message = 'API Error';
    let data;
    try {
      data = await response.json();
      message = data?.error?.message || data?.error || data?.message || message;
    } catch (e) {
      // Not JSON
    }
    throw new ApiError(response.status, message, data);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// Auth
export async function signup(data: SignupInput): Promise<AuthResponse> {
  return fetchApi<AuthResponse>('/auth/signup', { method: 'POST', body: JSON.stringify(data) });
}

export async function login(data: LoginInput): Promise<AuthResponse> {
  return fetchApi<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) });
}

export async function forgotPassword(data: { email: string }): Promise<{ message: string }> {
  return fetchApi<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify(data) });
}

export async function resetPassword(data: { token: string; password: string }): Promise<AuthResponse> {
  return fetchApi<AuthResponse>('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) });
}

export async function getMe(): Promise<MeResponse> {
  return fetchApi<MeResponse>('/auth/me');
}

export async function logout(): Promise<void> {
  return fetchApi<void>('/auth/logout', { method: 'POST' });
}

// Orgs
export async function getOrg(orgId: string): Promise<{ org: Organization }> {
  return fetchApi<{ org: Organization }>(`/orgs/${orgId}`);
}

export async function updateOrg(orgId: string, data: { name?: string; slug?: string }): Promise<{ org: Organization }> {
  return fetchApi<{ org: Organization }>(`/orgs/${orgId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

// Roles
export async function getRoles(orgId: string): Promise<{ roles: Role[] }> {
  return fetchApi<{ roles: Role[] }>(`/orgs/${orgId}/roles`);
}

export async function createRole(orgId: string, data: CreateRoleInput): Promise<{ role: Role }> {
  return fetchApi<{ role: Role }>(`/orgs/${orgId}/roles`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateRole(orgId: string, roleId: string, data: UpdateRoleInput): Promise<{ role: Role }> {
  return fetchApi<{ role: Role }>(`/orgs/${orgId}/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteRole(orgId: string, roleId: string): Promise<void> {
  return fetchApi<void>(`/orgs/${orgId}/roles/${roleId}`, { method: 'DELETE' });
}

// Policies
export async function getPolicies(orgId: string): Promise<{ policies: Policy[] }> {
  return fetchApi<{ policies: Policy[] }>(`/orgs/${orgId}/policies`);
}

export async function createPolicy(orgId: string, data: CreatePolicyInput): Promise<{ policy: Policy }> {
  return fetchApi<{ policy: Policy }>(`/orgs/${orgId}/policies`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updatePolicy(orgId: string, policyId: string, data: UpdatePolicyInput): Promise<{ policy: Policy }> {
  return fetchApi<{ policy: Policy }>(`/orgs/${orgId}/policies/${policyId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deletePolicy(orgId: string, policyId: string): Promise<void> {
  return fetchApi<void>(`/orgs/${orgId}/policies/${policyId}`, { method: 'DELETE' });
}

// Members
export async function getMembers(orgId: string): Promise<{ members: Membership[] }> {
  return fetchApi<{ members: Membership[] }>(`/orgs/${orgId}/members`);
}

export async function inviteMember(orgId: string, data: InviteMemberInput): Promise<{ membership: Membership }> {
  return fetchApi<{ membership: Membership }>(`/orgs/${orgId}/members/invite`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateMember(orgId: string, userId: string, data: UpdateMemberInput): Promise<{ membership: Membership }> {
  return fetchApi<{ membership: Membership }>(`/orgs/${orgId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteMember(orgId: string, userId: string): Promise<void> {
  return fetchApi<void>(`/orgs/${orgId}/members/${userId}`, { method: 'DELETE' });
}

// API Keys
export async function getApiKeys(orgId: string): Promise<{ apiKeys: ApiKey[] }> {
  return fetchApi<{ apiKeys: ApiKey[] }>(`/orgs/${orgId}/api-keys`);
}

export async function createApiKey(orgId: string, data: CreateApiKeyInput): Promise<{ apiKey: ApiKey; key: string }> {
  return fetchApi<{ apiKey: ApiKey; key: string }>(`/orgs/${orgId}/api-keys`, { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteApiKey(orgId: string, keyId: string): Promise<void> {
  return fetchApi<void>(`/orgs/${orgId}/api-keys/${keyId}`, { method: 'DELETE' });
}

// Audit Log
export async function getAuditLog(orgId: string, params?: { cursor?: string; limit?: number; action?: string }): Promise<{ data: AuditLogEntry[], nextCursor?: string, hasMore: boolean }> {
  const query = new URLSearchParams();
  if (params?.cursor) query.append('cursor', params.cursor);
  if (params?.limit) query.append('limit', params.limit.toString());
  if (params?.action) query.append('action', params.action);

  const queryString = query.toString() ? `?${query.toString()}` : '';
  return fetchApi<{ data: AuditLogEntry[], nextCursor?: string, hasMore: boolean }>(`/orgs/${orgId}/audit${queryString}`);
}

export const fetcher = async (url: string) => {
  return fetchApi(url);
};

// SSO
export async function getSsoConfig(orgId: string): Promise<{ ssoConfig: SsoConfig | null }> {
  return fetchApi<{ ssoConfig: SsoConfig | null }>(`/orgs/${orgId}/sso`);
}

export async function saveSsoConfig(orgId: string, data: { provider: string; workosOrgId: string; connectionId: string }): Promise<{ ssoConfig: SsoConfig }> {
  return fetchApi<{ ssoConfig: SsoConfig }>(`/orgs/${orgId}/sso`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function testSsoConnection(orgId: string): Promise<{ success: boolean; error?: string }> {
  return fetchApi<{ success: boolean; error?: string }>(`/orgs/${orgId}/sso/test`, { method: 'POST' });
}

// Policy Check
export async function checkPolicy(orgId: string, data: { type: 'code' | 'command'; content: string; roleName: string; filePath?: string }): Promise<{ passed: boolean; violations: any[] }> {
  return fetchApi<{ passed: boolean; violations: any[] }>(`/orgs/${orgId}/check`, { method: 'POST', body: JSON.stringify(data) });
}

// Policy Versions
export async function getPolicyVersions(orgId: string, policyId: string): Promise<{ versions: PolicyVersion[] }> {
  return fetchApi<{ versions: PolicyVersion[] }>(`/orgs/${orgId}/policies/${policyId}/versions`);
}

// Policy Rollback
export async function rollbackPolicy(orgId: string, policyId: string, versionId: string): Promise<{ policy: Policy }> {
  return fetchApi<{ policy: Policy }>(`/orgs/${orgId}/policies/${policyId}/rollback/${versionId}`, { method: 'POST' });
}
