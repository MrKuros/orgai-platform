import { OrgAIClient, OrgInfo } from '../orgai-client';

describe('OrgAIClient', () => {
  const mockApiKey = 'test-api-key-12345';
  const mockApiUrl = 'https://api.orgai.dev';

  let client: OrgAIClient;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    client = new OrgAIClient(mockApiKey, mockApiUrl);
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrgInfo', () => {
    test('fetches org info from correct endpoint', async () => {
      const mockOrgInfo: OrgInfo = {
        orgId: 'org-123',
        orgName: 'Test Org',
        orgSlug: 'test-org',
        keyName: 'Test Key',
        scopes: ['check', 'resolve'],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockOrgInfo),
      });

      const result = await client.getOrgInfo();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.orgai.dev/v1/auth/me/api',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': mockApiKey,
          },
        })
      );
      expect(result).toEqual(mockOrgInfo);
    });

    test('caches org info after first fetch', async () => {
      const mockOrgInfo: OrgInfo = {
        orgId: 'org-123',
        orgName: 'Test Org',
        orgSlug: 'test-org',
        keyName: 'Test Key',
        scopes: ['check', 'resolve'],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockOrgInfo),
      });

      await client.getOrgInfo();
      await client.getOrgInfo();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('throws error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(client.getOrgInfo()).rejects.toThrow('OrgAI API error 401: Unauthorized');
    });

    test('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getOrgInfo()).rejects.toThrow('Network error');
    });
  });

  describe('resolveRole', () => {
    test('fetches resolved policies for role', async () => {
      const mockResponse = {
        role: { id: 'role-123', name: 'senior', displayName: 'Senior Developer' },
        resolvedFrom: ['cto', 'lead', 'senior'],
        policies: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.resolveRole('org-123', 'senior');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.orgai.dev/v1/orgs/org-123/resolve/senior',
        expect.objectContaining({
          method: 'GET',
        })
      );
      expect(result).toEqual(mockResponse);
    });

    test('throws error on role not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Role not found'),
      });

      await expect(client.resolveRole('org-123', 'nonexistent')).rejects.toThrow(
        'OrgAI API error 404: Role not found'
      );
    });
  });

  describe('reportViolation', () => {
    test('posts violation to correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await client.reportViolation('org-123', {
        type: 'code',
        content: 'const secret = "sk-123"',
        filePath: 'src/config.ts',
        roleName: 'senior',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.orgai.dev/v1/orgs/org-123/check',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            type: 'code',
            content: 'const secret = "sk-123"',
            filePath: 'src/config.ts',
            roleName: 'senior',
          }),
        })
      );
    });

    test('reports command violations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await client.reportViolation('org-123', {
        type: 'command',
        content: 'git push --force',
        roleName: 'senior',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.orgai.dev/v1/orgs/org-123/check',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            type: 'command',
            content: 'git push --force',
            roleName: 'senior',
          }),
        })
      );
    });
  });

  describe('clearCache', () => {
    test('clears org info cache', async () => {
      const mockOrgInfo: OrgInfo = {
        orgId: 'org-123',
        orgName: 'Test Org',
        orgSlug: 'test-org',
        keyName: 'Test Key',
        scopes: ['check', 'resolve'],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOrgInfo),
      });

      await client.getOrgInfo();
      client.clearCache();
      await client.getOrgInfo();

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('apiUrl normalization', () => {
    test('removes trailing slash from apiUrl', () => {
      const clientWithSlash = new OrgAIClient('key', 'https://api.orgai.dev/');
      expect((clientWithSlash as any).apiUrl).toBe('https://api.orgai.dev');
    });
  });
});
