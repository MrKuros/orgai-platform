import * as vscode from 'vscode';

export interface OrgInfo {
  orgId: string;
  orgName: string;
  orgSlug: string;
  keyName: string;
  scopes: string[];
}

export interface ResolvedPoliciesResponse {
  role: { id: string; name: string; displayName: string };
  resolvedFrom: string[];
  policies: any[];
}

export class OrgAIClient {
  private orgInfoCache: OrgInfo | null = null;
  private apiKey: string;
  private apiUrl: string;

  constructor(apiKey: string, apiUrl: string) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl.replace(/\/$/, '');
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        ...options?.headers,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OrgAI API error ${response.status}: ${text}`);
    }
    return response.json() as Promise<T>;
  }

  async getOrgInfo(): Promise<OrgInfo> {
    if (this.orgInfoCache) return this.orgInfoCache;
    const result = await this.fetch<OrgInfo>('/v1/auth/me/api');
    this.orgInfoCache = result;
    return result;
  }

  async resolveRole(orgId: string, roleName: string): Promise<ResolvedPoliciesResponse> {
    return this.fetch(`/v1/orgs/${orgId}/resolve/${roleName}`);
  }

  async reportViolation(orgId: string, params: {
    type: 'code' | 'command';
    content: string;
    filePath?: string;
    roleName: string;
  }): Promise<void> {
    await this.fetch(`/v1/orgs/${orgId}/check`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  clearCache(): void {
    this.orgInfoCache = null;
  }
}
