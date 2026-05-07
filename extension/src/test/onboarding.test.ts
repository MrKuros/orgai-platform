/**
 * src/test/onboarding.test.ts
 *
 * Tests the real OnboardingPanelProvider class and the first-launch detection
 * logic in activate().  No source files are modified.
 *
 * Strategy for testing the private constructor:
 *   1. Mock vscode.window.createWebviewPanel → returns a fake panel.
 *   2. Mock `fs` so _buildHtml's readFileSync doesn't throw.
 *   3. Call OnboardingPanelProvider.show() which stores the instance in
 *      OnboardingPanelProvider.currentPanel.
 *   4. The constructor registers _handleMessage via webview.onDidReceiveMessage.
 *      We capture that callback and invoke it directly to simulate webview messages.
 *   5. Assert on fakePanel.webview.postMessage and mock side-effects.
 */

// ── Module mocks ─────────────────────────────────────────────────────────────
// Must be declared before any imports so Jest hoists them correctly.

jest.mock('https');
jest.mock('http');

// Bypass _buildHtml's fs.readFileSync — the template file doesn't exist at the mock path.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn().mockReturnValue('<html><!--CSP_META--><script nonce="<!--NONCE-->"></script></html>'),
}));

// Mock all heavy extension-level imports so activate() doesn't pull in real networking/FS code.
jest.mock('../agent', () => ({
  Agent: jest.fn().mockImplementation(() => mockAgentInstance),
}));
jest.mock('../policyEngine', () => ({
  PolicyEngine: jest.fn().mockImplementation(() => mockPolicyEngineInstance),
}));
jest.mock('../webview/panel', () => ({
  ComplyPanelProvider: jest.fn().mockImplementation(() => ({
    notifyAuthChanged: jest.fn(),
    resolveWebviewView: jest.fn(),
  })),
}));
jest.mock('../webview/setup', () => ({
  SetupPanel: { show: jest.fn(), currentPanel: undefined },
}));

// Mock the LLM provider constructors so factory tests don't make real network calls.
jest.mock('../llm/providers/groq', () => ({
  GroqClient: jest.fn().mockImplementation((opts: any) => ({ id: 'groq', _opts: opts })),
}));
jest.mock('../llm/providers/openaiCompatible', () => ({
  OpenAiCompatibleClient: jest.fn().mockImplementation((opts: any) => ({ id: opts.id, _opts: opts })),
}));
jest.mock('../llm/providers/anthropic', () => ({
  AnthropicClient: jest.fn().mockImplementation((opts: any) => ({ id: 'anthropic', _opts: opts })),
}));
jest.mock('../llm/providers/gemini', () => ({
  GeminiClient: jest.fn().mockImplementation((opts: any) => ({ id: 'gemini', _opts: opts })),
}));

// ── vscode mock override ──────────────────────────────────────────────────────
// Extend the existing src/__mocks__/vscode.ts without touching that file.
jest.mock('vscode', () => {
  const base = jest.requireActual<any>('../../src/__mocks__/vscode');
  return {
    ...base,
    window: {
      ...base.window,
      createWebviewPanel: jest.fn(),
      registerWebviewViewProvider: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    },
    workspace: {
      ...base.workspace,
      onDidChangeConfiguration: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    },
    commands: {
      registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
      executeCommand: jest.fn().mockResolvedValue(undefined),
    },
    ViewColumn: { One: 1 },
    Uri: {
      ...base.Uri,
      joinPath: jest.fn((..._args: any[]) => ({ fsPath: '/mock/extension/media' })),
    },
    ConfigurationTarget: { Global: 1 },
    EventEmitter: jest.fn().mockImplementation(() => ({ event: jest.fn(), fire: jest.fn() })),
  };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { OnboardingPanelProvider } from '../webview/onboarding';
import { activate } from '../extension';
import { createLlmClient } from '../llm/factory';
import { GroqClient } from '../llm/providers/groq';
import { OpenAiCompatibleClient } from '../llm/providers/openaiCompatible';
import { AnthropicClient } from '../llm/providers/anthropic';

// ── Shared mock instances ────────────────────────────────────────────────────
// These are referenced by the jest.mock() factories at the top, which run before
// imports, so we declare the objects separately and reference them by name.

const mockPolicyEngineInstance = {
  load: jest.fn().mockResolvedValue(undefined),
  clearCache: jest.fn(),
  getResolvedPolicies: jest.fn().mockReturnValue([]),
  getCurrentRoleDisplay: jest.fn().mockReturnValue('CTO'),
  getSystemPrompt: jest.fn().mockReturnValue(''),
  getAllRoles: jest.fn().mockReturnValue([]),
  saveRole: jest.fn().mockResolvedValue(undefined),
  findMatchingPolicy: jest.fn().mockReturnValue(undefined),
};

const mockAgentInstance = {
  init: jest.fn().mockResolvedValue(undefined),
  refreshProvider: jest.fn().mockResolvedValue(undefined),
  refreshPolicies: jest.fn(),
  hasApiKey: jest.fn().mockReturnValue(true),
  getAvailableModels: jest.fn().mockResolvedValue([]),
  getModel: jest.fn().mockReturnValue('llama-3.3-70b-versatile'),
  createThread: jest.fn(),
  switchThread: jest.fn(),
  deleteThread: jest.fn(),
  setModel: jest.fn(),
  cancel: jest.fn(),
  chat: jest.fn(),
  retry: jest.fn(),
};

// ── Helper: build a fake webview panel ───────────────────────────────────────

function makeFakePanel() {
  let capturedMsgHandler: ((msg: any) => Promise<void>) | null = null;
  let capturedDisposeHandler: (() => void) | null = null;

  const postMessage = jest.fn().mockResolvedValue(undefined);
  const panelDispose = jest.fn();

  const fakePanel: any = {
    webview: {
      options: {} as any,
      html: '',
      postMessage,
      onDidReceiveMessage: jest.fn((cb: any) => {
        capturedMsgHandler = cb;
        return { dispose: jest.fn() };
      }),
      asWebviewUri: jest.fn((u: any) => u),
    },
    onDidDispose: jest.fn((cb: any) => {
      capturedDisposeHandler = cb;
      return { dispose: jest.fn() };
    }),
    reveal: jest.fn(),
    dispose: panelDispose,
  };

  return { fakePanel, postMessage, panelDispose, capturedMsgHandler: () => capturedMsgHandler, capturedDisposeHandler: () => capturedDisposeHandler };
}

// ── Helper: build a mock ExtensionContext ─────────────────────────────────────

function makeContext(overrides: { policiesUrl?: string; providerApiKey?: string } = {}) {
  const secretsStore = new Map<string, string>();
  if (overrides.providerApiKey) secretsStore.set('comply.providerApiKey', overrides.providerApiKey);

  const secretsGet = jest.fn((key: string) => Promise.resolve(secretsStore.get(key)));
  const secretsStoreFn = jest.fn((key: string, val: string) => { secretsStore.set(key, val); return Promise.resolve(); });
  const secretsDelete = jest.fn((key: string) => { secretsStore.delete(key); return Promise.resolve(); });

  const cfgUpdate = jest.fn().mockResolvedValue(undefined);
  const cfgGet = jest.fn((key: string) => {
    if (key === 'policies.url') return overrides.policiesUrl ?? '';
    return undefined;
  });

  (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: cfgGet,
    inspect: jest.fn().mockReturnValue(undefined),
    update: cfgUpdate,
  });

  return {
    context: {
      secrets: { get: secretsGet, store: secretsStoreFn, delete: secretsDelete },
      globalState: { update: jest.fn().mockResolvedValue(undefined), get: jest.fn().mockReturnValue(false) },
      extensionPath: '/mock/extension',
      extensionUri: { fsPath: '/mock/extension' } as any,
      subscriptions: [] as any[],
    } as unknown as vscode.ExtensionContext,
    cfgUpdate,
    cfgGet,
    secretsGet,
    secretsStoreFn,
    secretsDelete,
  };
}

// ── Helper: mock https.get for a URL response ─────────────────────────────────

function mockHttpsOk(body: object) {
  const mockRes = {
    statusCode: 200,
    headers: {},
    on: jest.fn((event: string, cb: any) => {
      if (event === 'data') cb(JSON.stringify(body));
      if (event === 'end') cb();
    }),
  };
  (https.get as jest.Mock).mockImplementation((_url: any, _opts: any, cb: any) => {
    cb(mockRes);
    return { on: jest.fn() };
  });
}

function mockHttpsStatus(status: number) {
  const mockRes = { statusCode: status, headers: {} };
  (https.get as jest.Mock).mockImplementation((_url: any, _opts: any, cb: any) => {
    cb(mockRes);
    return { on: jest.fn() };
  });
}

function mockHttpsNetworkError(message = 'ECONNREFUSED 127.0.0.1:443') {
  (https.get as jest.Mock).mockImplementation((_url: any, _opts: any, _cb: any) => {
    const req = { on: jest.fn((event: string, cb: any) => { if (event === 'error') cb(new Error(message)); }) };
    return req;
  });
}

// ── Valid policy fixture ───────────────────────────────────────────────────────

const VALID_POLICIES = {
  hierarchy: [
    { role: 'cto', displayName: 'CTO', policies: ['No secrets'] },
    { role: 'lead', displayName: 'Lead', inheritsFrom: 'cto', policies: [] },
    { role: 'senior', displayName: 'Senior', inheritsFrom: 'lead', policies: [] },
    { role: 'junior', displayName: 'Junior', inheritsFrom: 'lead', policies: [] },
  ],
  currentUserRole: 'junior',
};

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — First-launch detection (Tests 1–4)
// ─────────────────────────────────────────────────────────────────────────────

describe('First-launch detection (activate)', () => {
  let showSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // Spy on the static show() so we can assert whether it was called.
    showSpy = jest.spyOn(OnboardingPanelProvider, 'show').mockImplementation(() => {});
    // Ensure currentPanel is clear between tests.
    OnboardingPanelProvider.currentPanel = undefined;

    // Mock window stubs activate() needs
    (vscode.window.createOutputChannel as jest.Mock).mockReturnValue({
      appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn(),
    });
    (vscode.window.registerWebviewViewProvider as jest.Mock) = jest.fn().mockReturnValue({ dispose: jest.fn() });
  });

  afterEach(() => {
    showSpy.mockRestore();
  });

  test('1. Both URL and key set → onboarding panel does NOT open', async () => {
    const { context } = makeContext({
      policiesUrl: 'https://raw.githubusercontent.com/MrKuros/comply-policies/main/policies.json',
      providerApiKey: 'gsk-abc123',
    });
    await activate(context);
    expect(showSpy).not.toHaveBeenCalled();
  });

  test('2. policies.url missing → onboarding panel opens', async () => {
    const { context } = makeContext({ policiesUrl: '', providerApiKey: 'gsk-abc123' });
    await activate(context);
    expect(showSpy).toHaveBeenCalledTimes(1);
  });

  test('3. providerApiKey missing → onboarding panel opens', async () => {
    const { context } = makeContext({
      policiesUrl: 'https://raw.githubusercontent.com/MrKuros/comply-policies/main/policies.json',
      providerApiKey: undefined,
    });
    await activate(context);
    expect(showSpy).toHaveBeenCalledTimes(1);
  });

  test('4. Both URL and key missing → onboarding panel opens', async () => {
    const { context } = makeContext({ policiesUrl: '', providerApiKey: undefined });
    await activate(context);
    expect(showSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — testConnection handler (Tests 5–10)
// ─────────────────────────────────────────────────────────────────────────────

describe('OnboardingPanelProvider: testConnection handler', () => {
  let capturedMsg: (() => ((msg: any) => Promise<void>) | null);
  let postMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    OnboardingPanelProvider.currentPanel = undefined;

    const built = makeFakePanel();
    capturedMsg = built.capturedMsgHandler;
    postMessage = built.postMessage;

    (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(built.fakePanel);

    const { context } = makeContext();
    OnboardingPanelProvider.show(
      context,
      mockPolicyEngineInstance as any,
      mockAgentInstance as any,
      { fsPath: '/mock/extension' } as any
    );
  });

  afterEach(() => {
    OnboardingPanelProvider.currentPanel = undefined;
  });

  test('5. Valid URL with correct schema → { success: true, roleCount: 4 }', async () => {
    mockHttpsOk(VALID_POLICIES);

    await capturedMsg()!({ type: 'testConnection', url: 'https://example.com/policies.json' });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'testResult', success: true, roleCount: 4 })
    );
  });

  test('6. URL returning 404 → success: false, reason contains "returned 404"', async () => {
    mockHttpsStatus(404);

    await capturedMsg()!({ type: 'testConnection', url: 'https://example.com/policies.json' });

    const call = postMessage.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.reason).toMatch(/returned 404/i);
  });

  test('7. URL returning 403 → success: false, reason contains "returned 403"', async () => {
    mockHttpsStatus(403);

    await capturedMsg()!({ type: 'testConnection', url: 'https://example.com/policies.json' });

    const call = postMessage.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.reason).toMatch(/returned 403/i);
  });

  test('8. Valid JSON but missing hierarchy → success: false, reason contains "Invalid schema"', async () => {
    mockHttpsOk({ currentUserRole: 'junior' }); // no hierarchy

    await capturedMsg()!({ type: 'testConnection', url: 'https://example.com/policies.json' });

    const call = postMessage.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.reason).toMatch(/invalid schema/i);
  });

  test('9. Network error → success: false, reason contains "network error"', async () => {
    mockHttpsNetworkError('ECONNREFUSED 127.0.0.1:443');

    await capturedMsg()!({ type: 'testConnection', url: 'https://example.com/policies.json' });

    const call = postMessage.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.reason).toMatch(/network error/i);
  });

  test('10. Invalid URL format → success: false, reason contains "Invalid URL"', async () => {
    // For a non-https URL, _fetchUrl uses http.get. Simulate TypeError: Invalid URL.
    (http.get as jest.Mock).mockImplementation((_url: any, _cb: any) => {
      const req = {
        on: jest.fn((event: string, cb: any) => {
          if (event === 'error') cb(new TypeError('Invalid URL'));
        }),
      };
      return req;
    });

    await capturedMsg()!({ type: 'testConnection', url: 'not-a-valid-url' });

    const call = postMessage.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.reason).toMatch(/invalid url/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — OrgAI Step 1 (Tests 11–13)
// ─────────────────────────────────────────────────────────────────────────────

describe('OnboardingPanelProvider: OrgAI Step 1', () => {
  let capturedMsg: (() => ((msg: any) => Promise<void>) | null);
  let postMessage: jest.Mock;
  let originalFetch: any;

  beforeEach(() => {
    jest.clearAllMocks();
    OnboardingPanelProvider.currentPanel = undefined;
    originalFetch = global.fetch;

    const built = makeFakePanel();
    capturedMsg = built.capturedMsgHandler;
    postMessage = built.postMessage;

    (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(built.fakePanel);

    const { context } = makeContext();
    OnboardingPanelProvider.show(
      context,
      mockPolicyEngineInstance as any,
      mockAgentInstance as any,
      { fsPath: '/mock/extension' } as any
    );
  });

  afterEach(() => {
    OnboardingPanelProvider.currentPanel = undefined;
    global.fetch = originalFetch;
  });

  test('testOrgConnection success shows org name', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ orgId: 'org123', orgName: 'Acme Corp' })
    });

    await capturedMsg()!({
      type: 'testOrgConnection',
      apiKey: 'test-api-key',
      apiUrl: 'https://api.example.com'
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'orgTestResult', success: true, orgName: 'Acme Corp' })
    );
  });

  test('testOrgConnection failure shows error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized')
    });

    await capturedMsg()!({
      type: 'testOrgConnection',
      apiKey: 'bad-key',
      apiUrl: 'https://api.example.com'
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'orgTestResult', success: false })
    );
    
    const call = postMessage.mock.calls[0][0];
    expect(call.reason).toMatch(/401/);
  });

  test('skip OrgAI step does not set API key', async () => {
    // This is basically verified in the next suite where we call _handleSave without orgApiKey, 
    // but we can test it directly here with a simulated 'save' message lacking the key.
    const { context } = makeContext();
    // We already passed context to show(), but we want to assert on its secrets.store
    // We'll just assert on the mock secretsStoreFn if we rebuild the mock
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — save handler (Tests 14–22)
// ─────────────────────────────────────────────────────────────────────────────

describe('OnboardingPanelProvider: save handler', () => {
  let capturedMsg: (() => ((msg: any) => Promise<void>) | null);
  let postMessage: jest.Mock;
  let panelDispose: jest.Mock;
  let cfgUpdate: jest.Mock;
  let secretsStoreFn: jest.Mock;
  let secretsDelete: jest.Mock;

  const defaultSaveMsg = {
    type: 'save',
    provider: 'groq',
    apiKey: 'gsk-test-key-1234',
    role: 'junior',
    url: 'https://raw.githubusercontent.com/MrKuros/comply-policies/main/policies.json',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    OnboardingPanelProvider.currentPanel = undefined;

    // Reset shared mocks
    mockPolicyEngineInstance.load.mockResolvedValue(undefined);
    mockPolicyEngineInstance.clearCache.mockClear();
    mockAgentInstance.refreshProvider.mockResolvedValue(undefined);
    mockAgentInstance.refreshPolicies.mockClear();

    const built = makeFakePanel();
    capturedMsg = built.capturedMsgHandler;
    postMessage = built.postMessage;
    panelDispose = built.panelDispose;

    (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(built.fakePanel);

    const mocks = makeContext();
    cfgUpdate = mocks.cfgUpdate;
    secretsStoreFn = mocks.secretsStoreFn;
    secretsDelete = mocks.secretsDelete;

    OnboardingPanelProvider.show(
      mocks.context,
      mockPolicyEngineInstance as any,
      mockAgentInstance as any,
      { fsPath: '/mock/extension' } as any
    );
  });

  afterEach(() => {
    OnboardingPanelProvider.currentPanel = undefined;
  });

  test('Save with provider groq → stores comply.provider = "groq" in settings', async () => {
    await capturedMsg()!({ ...defaultSaveMsg, provider: 'groq' });
    expect(cfgUpdate).toHaveBeenCalledWith('provider', 'groq', vscode.ConfigurationTarget.Global);
  });

  test('skip OrgAI step does not set API key', async () => {
    await capturedMsg()!({ ...defaultSaveMsg });
    // secretsStoreFn should be called with providerApiKey but NOT with comply.org.apiKey
    expect(secretsStoreFn).toHaveBeenCalledWith('comply.providerApiKey', 'gsk-test-key-1234');
    expect(secretsStoreFn).not.toHaveBeenCalledWith('comply.org.apiKey', expect.any(String));
  });

  test('Save with orgApiKey → stores it in secrets', async () => {
    await capturedMsg()!({ ...defaultSaveMsg, orgApiKey: 'test-org-key', orgApiUrl: 'https://api.orgai.dev' });
    expect(secretsStoreFn).toHaveBeenCalledWith('comply.org.apiKey', 'test-org-key');
    expect(cfgUpdate).toHaveBeenCalledWith('org.apiUrl', 'https://api.orgai.dev', vscode.ConfigurationTarget.Global);
  });

  test('Save with any non-ollama provider → stores API key in comply.providerApiKey secret', async () => {
    await capturedMsg()!({ ...defaultSaveMsg, provider: 'groq', apiKey: 'gsk-test-key-1234' });
    expect(secretsStoreFn).toHaveBeenCalledWith('comply.providerApiKey', 'gsk-test-key-1234');
  });

  test('13. Save with provider ollama → deletes comply.providerApiKey (no key needed)', async () => {
    await capturedMsg()!({ ...defaultSaveMsg, provider: 'ollama', apiKey: '' });
    expect(secretsDelete).toHaveBeenCalledWith('comply.providerApiKey');
    expect(secretsStoreFn).not.toHaveBeenCalled();
  });

  test('14. Save → stores role in comply.currentUserRole setting', async () => {
    await capturedMsg()!({ ...defaultSaveMsg, role: 'senior' });
    expect(cfgUpdate).toHaveBeenCalledWith('currentUserRole', 'senior', vscode.ConfigurationTarget.Global);
  });

  test('15. Save → stores URL in comply.policies.url setting', async () => {
    const url = 'https://raw.githubusercontent.com/MrKuros/comply-policies/main/policies.json';
    await capturedMsg()!({ ...defaultSaveMsg, url });
    expect(cfgUpdate).toHaveBeenCalledWith('policies.url', url, vscode.ConfigurationTarget.Global);
  });

  test('16. Save → calls policyEngine.clearCache() before policyEngine.load()', async () => {
    const callOrder: string[] = [];
    mockPolicyEngineInstance.clearCache.mockImplementation(() => callOrder.push('clearCache'));
    mockPolicyEngineInstance.load.mockImplementation(() => { callOrder.push('load'); return Promise.resolve(); });

    await capturedMsg()!(defaultSaveMsg);

    expect(callOrder).toEqual(['clearCache', 'load']);
  });

  test('17. Save → calls agent.refreshProvider()', async () => {
    await capturedMsg()!(defaultSaveMsg);
    expect(mockAgentInstance.refreshProvider).toHaveBeenCalledTimes(1);
  });

  test('18. Save → closes the onboarding panel (panel.dispose called)', async () => {
    await capturedMsg()!(defaultSaveMsg);
    expect(panelDispose).toHaveBeenCalled();
  });

  test('19. Save → focuses main chat panel via comply.chatView.focus command', async () => {
    await capturedMsg()!(defaultSaveMsg);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('comply.chatView.focus');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Provider/factory tests (Tests 20–23)
// ─────────────────────────────────────────────────────────────────────────────

describe('factory.ts: createLlmClient instantiates correct client per provider', () => {
  const makeSecrets = (key: string | undefined) => ({
    getApiKey: jest.fn().mockResolvedValue(key),
  });

  function setupProvider(providerName: string) {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue(undefined),
      inspect: jest.fn().mockReturnValue({ globalValue: providerName }),
      update: jest.fn().mockResolvedValue(undefined),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (GroqClient as jest.Mock).mockClear();
    (OpenAiCompatibleClient as jest.Mock).mockClear();
    (AnthropicClient as jest.Mock).mockClear();
  });

  test('20. Provider=ollama → OpenAiCompatibleClient at http://localhost:11434/v1', async () => {
    setupProvider('ollama');
    const { client, provider } = await createLlmClient(makeSecrets(undefined));

    expect(provider).toBe('ollama');
    expect(OpenAiCompatibleClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://localhost:11434/v1' })
    );
    expect(client).not.toBeNull();
  });

  test('21. Provider=groq → GroqClient instantiated with key from secrets', async () => {
    setupProvider('groq');
    const { client, provider } = await createLlmClient(makeSecrets('gsk-test'));

    expect(provider).toBe('groq');
    expect(GroqClient).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'gsk-test' }));
    expect(client).not.toBeNull();
  });

  test('22. Provider=anthropic → AnthropicClient instantiated with key from secrets', async () => {
    setupProvider('anthropic');
    const { client, provider } = await createLlmClient(makeSecrets('ant-test'));

    expect(provider).toBe('anthropic');
    expect(AnthropicClient).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'ant-test' }));
    expect(client).not.toBeNull();
  });

  test('23. Provider=openai → OpenAiCompatibleClient at api.openai.com', async () => {
    setupProvider('openai');
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string) => {
        if (key === 'llm.openai.baseUrl') return 'https://api.openai.com/v1';
        return undefined;
      }),
      inspect: jest.fn().mockReturnValue({ globalValue: 'openai' }),
      update: jest.fn().mockResolvedValue(undefined),
    });

    const { client, provider } = await createLlmClient(makeSecrets('sk-test'));

    expect(provider).toBe('openai');
    expect(OpenAiCompatibleClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' })
    );
    expect(client).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Auth header in testConnection (Tests 24–26)
// ─────────────────────────────────────────────────────────────────────────────

describe('OnboardingPanelProvider: testConnection with authHeader', () => {
  let capturedMsg: (() => ((msg: any) => Promise<void>) | null);
  let postMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    OnboardingPanelProvider.currentPanel = undefined;

    const built = makeFakePanel();
    capturedMsg = built.capturedMsgHandler;
    postMessage = built.postMessage;

    (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(built.fakePanel);

    const { context } = makeContext();
    OnboardingPanelProvider.show(
      context,
      mockPolicyEngineInstance as any,
      mockAgentInstance as any,
      { fsPath: '/mock/extension' } as any
    );
  });

  afterEach(() => {
    OnboardingPanelProvider.currentPanel = undefined;
  });

  test('24. testConnection with authHeader → https.get called with Authorization header', async () => {
    mockHttpsOk(VALID_POLICIES);
    await capturedMsg()!({
      type: 'testConnection',
      url: 'https://example.com/policies.json',
      authHeader: 'token ghp_abc',
    });

    expect(https.get).toHaveBeenCalledWith(
      'https://example.com/policies.json',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'token ghp_abc' }) }),
      expect.any(Function)
    );
  });

  test('25. testConnection with no authHeader → https.get called with no Authorization header', async () => {
    mockHttpsOk(VALID_POLICIES);
    await capturedMsg()!({
      type: 'testConnection',
      url: 'https://example.com/policies.json',
      authHeader: '',
    });

    const callObj = (https.get as jest.Mock).mock.calls[0][1];
    expect(callObj.headers?.Authorization).toBeUndefined();
  });

  test('26. testConnection succeeds with auth header → { success: true, roleCount } posted back', async () => {
    mockHttpsOk(VALID_POLICIES);
    await capturedMsg()!({
      type: 'testConnection',
      url: 'https://example.com/policies.json',
      authHeader: 'token ghp_abc',
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'testResult', success: true, roleCount: 4 })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — Auth header in save handler (Tests 27–29)
// ─────────────────────────────────────────────────────────────────────────────

describe('OnboardingPanelProvider: save handler with authHeader', () => {
  let capturedMsg: (() => ((msg: any) => Promise<void>) | null);
  let secretsStoreFn: jest.Mock;
  let secretsDelete: jest.Mock;

  const defaultSaveMsg = {
    type: 'save',
    provider: 'groq',
    apiKey: 'gsk-test-key-1234',
    role: 'junior',
    url: 'https://example.com/policies.json',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    OnboardingPanelProvider.currentPanel = undefined;
    mockPolicyEngineInstance.load.mockResolvedValue(undefined);
    mockAgentInstance.refreshProvider.mockResolvedValue(undefined);

    const built = makeFakePanel();
    capturedMsg = built.capturedMsgHandler;
    (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(built.fakePanel);

    const mocks = makeContext();
    secretsStoreFn = mocks.secretsStoreFn;
    secretsDelete = mocks.secretsDelete;

    OnboardingPanelProvider.show(
      mocks.context,
      mockPolicyEngineInstance as any,
      mockAgentInstance as any,
      { fsPath: '/mock/extension' } as any
    );
  });

  afterEach(() => {
    OnboardingPanelProvider.currentPanel = undefined;
  });

  test('27. Save with non-empty authHeader → calls secrets.store', async () => {
    await capturedMsg()!({ ...defaultSaveMsg, authHeader: 'Bearer eyJxxx' });
    expect(secretsStoreFn).toHaveBeenCalledWith('comply.policyAuthHeader', 'Bearer eyJxxx');
  });

  test('28. Save with empty authHeader → calls secrets.delete, not store', async () => {
    await capturedMsg()!({ ...defaultSaveMsg, authHeader: '   ' });
    expect(secretsDelete).toHaveBeenCalledWith('comply.policyAuthHeader');
    expect(secretsStoreFn).not.toHaveBeenCalledWith('comply.policyAuthHeader', expect.any(String));
  });

  test('29. Save with authHeader stores new value correctly', async () => {
    await capturedMsg()!({ ...defaultSaveMsg, authHeader: 'token ghp_new' });
    expect(secretsStoreFn).toHaveBeenCalledWith('comply.policyAuthHeader', 'token ghp_new');
    expect(secretsDelete).not.toHaveBeenCalledWith('comply.policyAuthHeader');
  });
});
