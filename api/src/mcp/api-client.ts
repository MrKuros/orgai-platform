type OrgInfo = { orgId: string; orgName: string; orgSlug: string; autoFix?: boolean; keyName: string; scopes: string[] };

const ORG_CACHE_TTL_MS = 60_000; // dashboard setting changes reach live sessions within a minute

export class OrgAIClient {
  private apiUrl: string;
  private apiKey: string;
  private orgCache: OrgInfo | null = null;
  private orgCacheAt = 0;

  constructor(apiKey?: string, apiUrl?: string) {
    this.apiKey = apiKey || process.env.COMPLY_API_KEY || '';
    // Merged mode calls back into this same process, so bind to the actual
    // listening port rather than assuming 8080 (Render/other hosts set PORT)
    this.apiUrl = apiUrl
      || process.env.ORGAI_API_URL
      || `http://localhost:${process.env.PORT || 8080}`;
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    if (!this.apiKey) {
      throw new Error("COMPLY_API_KEY is not set. Cannot use OrgAI API mode.");
    }
    const res = await fetch(`${this.apiUrl}${endpoint}`, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(10_000),
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
    if (this.orgCache && Date.now() - this.orgCacheAt < ORG_CACHE_TTL_MS) return this.orgCache;
    const data = await this.request('/v1/auth/me/api');
    this.orgCache = data as OrgInfo;
    this.orgCacheAt = Date.now();
    return this.orgCache;
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