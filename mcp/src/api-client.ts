export class OrgAIClient {
  private apiUrl: string;
  private apiKey: string;
  private orgCache: { orgId: string, orgName: string, orgSlug: string, keyName: string, scopes: string[] } | null = null;

  constructor(apiKey?: string, apiUrl?: string) {
    this.apiKey = apiKey || process.env.COMPLY_API_KEY || '';
    this.apiUrl = apiUrl || process.env.ORGAI_API_URL || 'http://localhost:8080';
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    if (!this.apiKey) {
      throw new Error("COMPLY_API_KEY is not set. Cannot use OrgAI API mode.");
    }
    const res = await fetch(`${this.apiUrl}${endpoint}`, {
      ...options,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      throw new Error(`API Request failed: ${res.status} ${res.statusText} - ${errorText}`);
    }

    return res.json();
  }

  async getOrgFromApiKey() {
    if (this.orgCache) return this.orgCache;
    const data = await this.request('/v1/auth/me/api');
    this.orgCache = data;
    return data;
  }

  async listRoles(orgId: string) {
    return this.request(`/v1/orgs/${orgId}/roles`);
  }

  async resolveRole(orgId: string, roleName: string) {
    return this.request(`/v1/orgs/${orgId}/resolve/${roleName}`);
  }

  async check(orgId: string, params: { type: 'code' | 'command', content: string, filePath?: string, roleName: string }) {
    return this.request(`/v1/orgs/${orgId}/check`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getAuditLog(orgId: string, params?: { action?: string, actorId?: string, limit?: number, page?: number }) {
    const query = new URLSearchParams();
    if (params?.action) query.append('action', params.action);
    if (params?.actorId) query.append('actorId', params.actorId);
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.page) query.append('page', params.page.toString());
    const qs = query.toString();
    return this.request(`/v1/orgs/${orgId}/audit${qs ? `?${qs}` : ''}`);
  }
}
