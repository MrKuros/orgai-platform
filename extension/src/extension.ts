import * as vscode from 'vscode';
import { PolicyEngine } from './policyEngine';
import { Agent } from './agent';
import { ComplyPanelProvider } from './webview/panel';
import { SetupPanel } from './webview/setup';
import { OnboardingPanelProvider } from './webview/onboarding';
import { OrgStatusBar } from './orgStatusBar';

const SECRET_PREFIX = 'comply.apiKey.';

/**
 * Extension entry point — registers the sidebar webview and commands.
 */
export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Comply');
  output.appendLine('[Comply] Extension activating...');

  // Initialize policy engine
  const policySecrets = { get: (key: string) => context.secrets.get(key) as Promise<string | undefined> };
  const policyEngine = new PolicyEngine(context.extensionPath, output, policySecrets);
  
  const statusBar = new OrgStatusBar();
  context.subscriptions.push(statusBar);

  const updateStatusBar = () => {
    const orgClient = policyEngine.getOrgClient();
    if (orgClient) {
      // Need to cast to any to read private orgInfo, or we can use the getters
      const role = policyEngine.getCurrentRoleDisplay() || policyEngine.getCurrentRole();
      statusBar.setConnected(policyEngine.getOrgId() || 'Org', role);
    } else {
      statusBar.setStandalone();
    }
  };

  try {
    await policyEngine.load();
    updateStatusBar();
  } catch (err: any) {
    statusBar.setError(err.message);
  }

  output.appendLine(
    `[Comply] Loaded policies for role: ${policyEngine.getCurrentRoleDisplay()}`
  );
  output.appendLine(
    `[Comply] Total resolved policies: ${policyEngine.getResolvedPolicies().length}`
  );

  const secrets = {
    getApiKey: async (provider: string): Promise<string | undefined> => {
      // 1. Onboarding panel stores a single key under this canonical name.
      const onboardingKey = await context.secrets.get('comply.providerApiKey');
      if (onboardingKey) return onboardingKey;

      // 2. Legacy per-provider key stored by the old setup panel.
      const stored = await context.secrets.get(`${SECRET_PREFIX}${provider}`);
      if (stored) return stored;

      // 3. Dev environment-variable fallback.
      if (provider === 'groq') return process.env.GROQ_API_KEY;
      if (provider === 'openai' || provider === 'openaiCompatible') return process.env.OPENAI_API_KEY;
      if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
      if (provider === 'gemini') return process.env.GEMINI_API_KEY;
      return undefined;
    },
  };

  // Initialize agent (may start without credentials; UI will guide user)
  const agent = new Agent({ policyEngine, output, secrets });
  await agent.init();

  // Register the sidebar webview provider
  const panelProvider = new ComplyPanelProvider(context.extensionUri, agent);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ComplyPanelProvider.viewType,
      panelProvider
    )
  );

  // Register the open chat command
  context.subscriptions.push(
    vscode.commands.registerCommand('comply.openChat', () => {
      // Focus the sidebar view
      vscode.commands.executeCommand('comply.chatView.focus');
    })
  );

  // Register command to reload policies
  context.subscriptions.push(
    vscode.commands.registerCommand('comply.reloadPolicies', async () => {
      output.appendLine('[Comply] Policy cache cleared, reloading...');
      policyEngine.clearCache();
      try {
        await policyEngine.load();
        updateStatusBar();
      } catch (err: any) {
        statusBar.setError(err.message);
      }
      agent.refreshPolicies();
      vscode.window.showInformationMessage(
        `Comply: Policies reloaded for role "${policyEngine.getCurrentRoleDisplay()}"`
      );
    })
  );

  // Register commands for managing API key
  context.subscriptions.push(
    vscode.commands.registerCommand('comply.openSetup', () => {
      SetupPanel.show(context, policyEngine, agent);
    })
  );

  // Register command to open onboarding panel directly
  context.subscriptions.push(
    vscode.commands.registerCommand('comply.openOnboarding', () => {
      OnboardingPanelProvider.show(context, policyEngine, agent, context.extensionUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('comply.setApiKey', async () => {
      const provider =
        (vscode.workspace.getConfiguration('comply').get<string>('llm.provider') ??
          'groq') as string;
      const key = await vscode.window.showInputBox({
        title: 'Comply: Set API Key',
        prompt: `Enter your ${provider} API key. It will be stored securely in Secret Storage.`,
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim().length < 10 ? 'Key looks too short.' : undefined),
      });
      if (!key) return;
      await context.secrets.store(`${SECRET_PREFIX}${provider}`, key.trim());
      await agent.refreshProvider();
      vscode.window.showInformationMessage(`Comply: API key saved for ${provider}.`);
      output.appendLine(`[Comply] API key saved to Secret Storage for ${provider}.`);
      panelProvider.notifyAuthChanged(agent.hasApiKey());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('comply.clearApiKey', async () => {
      const provider =
        (vscode.workspace.getConfiguration('comply').get<string>('llm.provider') ??
          'groq') as string;
      await context.secrets.delete(`${SECRET_PREFIX}${provider}`);
      await agent.refreshProvider();
      vscode.window.showInformationMessage(`Comply: API key cleared for ${provider}.`);
      output.appendLine(`[Comply] API key cleared from Secret Storage for ${provider}.`);
      panelProvider.notifyAuthChanged(agent.hasApiKey());
    })
  );

  // ── First-launch detection ────────────────────────────────────────────────
  // Show the new onboarding panel if either:
  //   • comply.policies.url is not set in VS Code settings, OR
  //   • comply.providerApiKey does not exist in Secret Storage
  const policiesUrl = vscode.workspace
    .getConfiguration('comply')
    .get<string>('policies.url');
  const onboardingApiKey = await context.secrets.get('comply.providerApiKey');

  const needsOnboarding =
    !policiesUrl || policiesUrl.trim().length === 0 || !onboardingApiKey;

  if (needsOnboarding) {
    output.appendLine(
      '[Comply] First-launch detected — opening onboarding panel.'
    );
    OnboardingPanelProvider.show(context, policyEngine, agent, context.extensionUri);
  } else if (!agent.hasApiKey()) {
    // Has secrets but provider not yet initialised (e.g. changed provider key)
    output.appendLine(
      '[Comply] No API key configured for current provider. Run "Comply: Set API Key" to start.'
    );
  }

  // React to provider/model setting changes
  let policyDebounceTimer: NodeJS.Timeout | undefined;

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        e.affectsConfiguration('comply.llm.provider') ||
        e.affectsConfiguration('comply.llm.model') ||
        e.affectsConfiguration('comply.llm.openai.baseUrl') ||
        e.affectsConfiguration('comply.llm.openaiCompatible.baseUrl') ||
        e.affectsConfiguration('comply.llm.request.timeoutMs')
      ) {
        await agent.refreshProvider();
        panelProvider.notifyAuthChanged(agent.hasApiKey());
      }
      if (
        e.affectsConfiguration('comply.policies.url') ||
        e.affectsConfiguration('comply.org.apiKey') ||
        e.affectsConfiguration('comply.org.apiUrl') ||
        e.affectsConfiguration('comply.currentUserRole')
      ) {
        if (policyDebounceTimer) {
          clearTimeout(policyDebounceTimer);
        }
        policyDebounceTimer = setTimeout(async () => {
          output.appendLine('[Comply] Policy configuration changed, reloading...');
          policyEngine.refreshOrgClient();
          try {
            await policyEngine.load();
            updateStatusBar();
          } catch (err: any) {
            statusBar.setError(err.message);
          }
          agent.refreshPolicies();
        }, 500);
      }
    })
  );

  context.subscriptions.push(output);
  output.appendLine('[Comply] Extension activated successfully.');
}

export function deactivate() {
  // no-op
}
