import { PolicyEngine } from '../policyEngine';
import * as vscode from 'vscode';
import * as https from 'https';

jest.mock('https');

describe('PolicyEngine', () => {
  const mockConfig = {
    hierarchy: [
      { role: 'cto', displayName: 'CTO / Security', policies: [{
        id: 'no-secrets',
        rule: 'No secrets',
        skill: 'Use env vars',
        evaluator: { type: 'regex', pattern: 'secret=' },
        fix_suggestion: 'Move to .env',
        severity: 'error'
      }] },
      { role: 'lead', displayName: 'Engineering Lead', inheritsFrom: 'cto', policies: [{
        id: 'jsdoc-required',
        rule: 'JSDoc required',
        skill: 'Write JSDoc',
        evaluator: { type: 'none' },
        fix_suggestion: 'Add JSDoc',
        severity: 'warning'
      }] },
      { role: 'senior', displayName: 'Senior Developer', inheritsFrom: 'lead', policies: [{
        id: 'adr-required',
        rule: 'ADR comment required',
        skill: 'Write ADR',
        evaluator: { type: 'none' },
        fix_suggestion: 'Add ADR',
        severity: 'warning'
      }] },
      { role: 'junior', displayName: 'Junior Developer', inheritsFrom: 'lead', policies: [] }
    ],
    currentUserRole: 'junior'
  };

  let engine: PolicyEngine;
  let mockOutput: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOutput = {
      appendLine: jest.fn(),
      show: jest.fn()
    };
    engine = new PolicyEngine('/mock/extension/path', mockOutput);
    
    // Default mock for vscode.workspace.getConfiguration
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'policies.url') return '';
        return '';
      })
    });
  });

  describe('Policy Chain Resolution', () => {
    test('Resolving junior returns 2 policies (cto + lead)', async () => {
      // Mock local load
      (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(mockConfig)));
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });

      await engine.load();
      const resolved = engine.getResolvedPolicies();
      
      expect(resolved.length).toBe(2);
      expect(resolved[0].setByDisplayName).toBe('CTO / Security');
      expect(resolved[1].setByDisplayName).toBe('Engineering Lead');
    });

    test('Resolving senior returns 3 policies', async () => {
      const seniorConfig = { ...mockConfig, currentUserRole: 'senior' };
      (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(seniorConfig)));
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });

      await engine.load();
      const resolved = engine.getResolvedPolicies();
      expect(resolved.length).toBe(3);
    });

    test('Resolving lead returns 2 policies', async () => {
      const leadConfig = { ...mockConfig, currentUserRole: 'lead' };
      (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(leadConfig)));
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });

      await engine.load();
      expect(engine.getResolvedPolicies().length).toBe(2);
    });

    test('Resolving cto returns 1 policy', async () => {
      const ctoConfig = { ...mockConfig, currentUserRole: 'cto' };
      (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(ctoConfig)));
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });

      await engine.load();
      expect(engine.getResolvedPolicies().length).toBe(1);
    });

    test('Backward compatibility: resolves plain string policies to objects', async () => {
      const legacyConfig = {
        hierarchy: [
          { role: 'cto', displayName: 'CTO', policies: ['Legacy string policy'] }
        ],
        currentUserRole: 'cto'
      };
      (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(legacyConfig)));
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });

      await engine.load();
      const resolved = engine.getResolvedPolicies();
      
      expect(resolved.length).toBe(1);
      expect(resolved[0].rule).toBe('Legacy string policy');
      expect(resolved[0].evaluator.type).toBe('none');
      expect(resolved[0].severity).toBe('error');
    });

    test('System prompt includes skills', async () => {
      (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(mockConfig)));
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });

      await engine.load();
      const prompt = engine.getSystemPrompt();
      
      expect(prompt).toContain('Rule: No secrets');
      expect(prompt).toContain('How to comply: Use env vars');
    });
  });

  describe('Schema Validation', () => {
    test('Valid schema with objects passes', async () => {
      (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(mockConfig)));
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });

      await engine.load();
      expect(engine.getResolvedPolicies().length).toBe(2);
    });

    test('Malformed policy object falls back (logs and shows error)', async () => {
      const badConfig = { ...mockConfig, hierarchy: [{ role: 'cto', displayName: 'CTO', policies: [{ rule: 'missing fields' }] }] } as any;
      (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(badConfig)));
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });

      await engine.load();
      expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringMatching(/Failed to load any policies/));
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Comply: Failed to load any policies. Check your policy configuration.');
    });

    test('Invalid schema (missing hierarchy) falls back (logs and shows error)', async () => {
      (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify({ currentUserRole: 'junior' })));
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });

      await engine.load();
      expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringMatching(/Failed to load any policies/));
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Comply: Failed to load any policies. Check your policy configuration.');
    });

    test('Invalid policy (null) falls back (logs and shows error)', async () => {
      const badConfig = { ...mockConfig, hierarchy: [{ role: 'cto', displayName: 'CTO', policies: [null] }] } as any;
      (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(badConfig)));
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });

      await engine.load();
      expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringMatching(/Failed to load any policies/));
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Comply: Failed to load any policies. Check your policy configuration.');
    });
  });

  describe('OrgAI API Source', () => {
    let mockSecrets: any;
    let originalFetch: any;

    beforeEach(() => {
      mockSecrets = { get: jest.fn() };
      engine = new PolicyEngine('/mock/extension/path', mockOutput, mockSecrets);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('API source loads correctly when apiKey is set', async () => {
      mockSecrets.get.mockResolvedValue('test-api-key');
      
      const mockFetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/me/api')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ orgId: 'org-123', orgName: 'Acme Corp' })
          });
        }
        if (url.includes('/resolve/')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              role: { id: 'r1', name: 'junior', displayName: 'Junior Developer' },
              resolvedFrom: ['junior'],
              policies: [{ id: 'p1', rule: 'api-rule', evaluatorType: 'none', severity: 'error' }]
            })
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });
      global.fetch = mockFetch;

      await engine.load();

      const resolved = engine.getResolvedPolicies();
      expect(resolved.length).toBe(1);
      expect(resolved[0].rule).toBe('api-rule');
      expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringMatching(/Policies loaded from OrgAI platform: Acme Corp/));
      expect(engine.getOrgClient()).not.toBeNull();
    });

    test('API source fails gracefully and falls back', async () => {
      mockSecrets.get.mockResolvedValue('test-api-key');
      
      global.fetch = jest.fn().mockRejectedValue(new Error('Network fail'));
      
      // Setup fallback remote config
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'policies.url') return 'http://remote.json';
          return '';
        })
      });

      const mockRes = {
        statusCode: 200,
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === 'data') cb(JSON.stringify(mockConfig));
          if (event === 'end') cb();
        })
      };
      (https.get as jest.Mock).mockImplementation((url, _opts, cb) => {
        cb(mockRes);
        return { on: jest.fn() };
      });

      await engine.load();

      expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringMatching(/OrgAI API unavailable.*falling back/));
      expect(engine.getResolvedPolicies().length).toBe(2); // From mockConfig fallback
    });

    test('Role change triggers policyEngine.load() with new role', async () => {
      mockSecrets.get.mockResolvedValue('test-api-key');
      
      let configRole = 'junior';
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'currentUserRole') return configRole;
          return '';
        })
      });

      const mockFetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/me/api')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ orgId: 'org-123', orgName: 'Acme Corp' })
          });
        }
        if (url.includes('/resolve/junior')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              role: { id: 'r1', name: 'junior', displayName: 'Junior Developer' },
              resolvedFrom: ['junior'],
              policies: [{ id: 'p1', rule: 'api-rule-junior', evaluatorType: 'none', severity: 'error' }]
            })
          });
        }
        if (url.includes('/resolve/lead')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              role: { id: 'r2', name: 'lead', displayName: 'Engineering Lead' },
              resolvedFrom: ['lead'],
              policies: [{ id: 'p2', rule: 'api-rule-lead', evaluatorType: 'none', severity: 'error' }]
            })
          });
        }
        return Promise.reject(new Error('Unknown URL: ' + url));
      });
      global.fetch = mockFetch;

      await engine.load();
      expect(engine.getResolvedPolicies()[0].rule).toBe('api-rule-junior');

      // Simulate role change
      configRole = 'lead';
      engine.refreshOrgClient();
      await engine.load();

      expect(engine.getResolvedPolicies()[0].rule).toBe('api-rule-lead');
    });
  });

  describe('Remote Fetch', () => {
    test('Success (200) loads remote config', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('http://remote.json')
      });

      const mockRes = {
        statusCode: 200,
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === 'data') cb(JSON.stringify(mockConfig));
          if (event === 'end') cb();
        })
      };
      (https.get as jest.Mock).mockImplementation((url, _opts, cb) => {
        cb(mockRes);
        return { on: jest.fn() };
      });

      await engine.load();
      expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringMatching(/Policies loaded from remote/));
      expect(engine.getResolvedPolicies().length).toBe(2);
    });

    test('Status 404 falls back and logs', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('http://remote.json')
      });

      const mockRes = { statusCode: 404 };
      (https.get as jest.Mock).mockImplementation((url, _opts, cb) => {
        cb(mockRes);
        return { on: jest.fn() };
      });

      await engine.load();
      expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringMatching(/returned 404/));
    });

    test('Status 403 falls back and logs', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('http://remote.json')
      });

      const mockRes = { statusCode: 403 };
      (https.get as jest.Mock).mockImplementation((url, _opts, cb) => {
        cb(mockRes);
        return { on: jest.fn() };
      });

      await engine.load();
      expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringMatching(/returned 403/));
    });

    test('Network error falls back', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('http://remote.json')
      });

      (https.get as jest.Mock).mockReturnValue({
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === 'error') cb(new Error('Network fail'));
        })
      });

      await engine.load();
      expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringMatching(/Remote policy fetch failed/));
    });

    test('Invalid remote JSON falls back', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('http://remote.json')
      });

      const mockRes = {
        statusCode: 200,
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === 'data') cb('invalid json');
          if (event === 'end') cb();
        })
      };
      (https.get as jest.Mock).mockImplementation((url, _opts, cb) => {
        cb(mockRes);
        return { on: jest.fn() };
      });

      await engine.load();
      expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringMatching(/Remote policy fetch failed/));
    });

    test('A. secrets.get returns auth header -> passed to https.get options', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('http://remote.json')
      });

      const mockRes = {
        statusCode: 200,
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === 'data') cb(JSON.stringify(mockConfig));
          if (event === 'end') cb();
        })
      };
      (https.get as jest.Mock).mockImplementation((url, _opts, cb) => {
        cb(mockRes);
        return { on: jest.fn() };
      });

      const secrets = { get: jest.fn().mockResolvedValue('token ghp_abc') };
      engine = new PolicyEngine('/mock/extension/path', mockOutput, secrets);
      
      await engine.load();
      
      expect(https.get).toHaveBeenCalledWith(
        'http://remote.json',
        expect.objectContaining({ headers: { Authorization: 'token ghp_abc' } }),
        expect.any(Function)
      );
    });

    test('B. secrets.get returns undefined -> https.get options without Authorization', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('http://remote.json')
      });

      const mockRes = {
        statusCode: 200,
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === 'data') cb(JSON.stringify(mockConfig));
          if (event === 'end') cb();
        })
      };
      (https.get as jest.Mock).mockImplementation((url, _opts, cb) => {
        cb(mockRes);
        return { on: jest.fn() };
      });

      const secrets = { get: jest.fn().mockResolvedValue(undefined) };
      engine = new PolicyEngine('/mock/extension/path', mockOutput, secrets);
      
      await engine.load();
      
      const callArgs = (https.get as jest.Mock).mock.calls[0];
      expect(callArgs[1].headers?.Authorization).toBeUndefined();
    });

    test('C. PolicyEngine without secrets arg -> falls back normally without Authorization', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('http://remote.json')
      });

      const mockRes = {
        statusCode: 200,
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === 'data') cb(JSON.stringify(mockConfig));
          if (event === 'end') cb();
        })
      };
      (https.get as jest.Mock).mockImplementation((url, _opts, cb) => {
        cb(mockRes);
        return { on: jest.fn() };
      });

      engine = new PolicyEngine('/mock/extension/path', mockOutput);
      
      await engine.load();
      
      expect(engine.getResolvedPolicies().length).toBe(2);
      const callArgs = (https.get as jest.Mock).mock.calls[0];
      expect(callArgs[1].headers?.Authorization).toBeUndefined();
    });
  });

  describe('Cache Behaviour', () => {
    test('Second load() without reload uses cache', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('http://remote.json')
      });

      const mockRes = {
        statusCode: 200,
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === 'data') cb(JSON.stringify(mockConfig));
          if (event === 'end') cb();
        })
      };
      (https.get as jest.Mock).mockImplementation((url, _opts, cb) => {
        cb(mockRes);
        return { on: jest.fn() };
      });

      await engine.load();
      await engine.load();
      
      expect(https.get).toHaveBeenCalledTimes(1);
      expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringMatching(/Policies loaded from cache/));
    });

    test('Clear cache causes new request', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('http://remote.json')
      });

      const mockRes = {
        statusCode: 200,
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === 'data') cb(JSON.stringify(mockConfig));
          if (event === 'end') cb();
        })
      };
      (https.get as jest.Mock).mockImplementation((url, _opts, cb) => {
        cb(mockRes);
        return { on: jest.fn() };
      });

      await engine.load();
      engine.clearCache();
      await engine.load();
      
      expect(https.get).toHaveBeenCalledTimes(2);
    });
  });
});
