import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { PolicyEngine } from '../policyEngine';
import { Agent } from '../agent';
import { OrgAIClient } from '../orgai-client';

/**
 * OnboardingPanelProvider — shown on first launch when either
 * `comply.policies.url` is missing or `comply.providerApiKey` secret is absent.
 *
 * Messages handled (from the webview UI):
 *   testConnection { url, authHeader? } → { type:'testResult', success, roleCount?, reason? }
 *   save { provider, apiKey, role, url, authHeader? } → stores settings, loads policies, opens chat
 */
export class OnboardingPanelProvider {
  public static currentPanel: OnboardingPanelProvider | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly _context: vscode.ExtensionContext,
    private readonly _policyEngine: PolicyEngine,
    private readonly _agent: Agent,
    private readonly _extensionUri: vscode.Uri
  ) {
    this._panel = panel;
    this._panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
    };
    this._panel.webview.html = this._buildHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables
    );
  }

  // ── Public surface ──────────────────────────────────────────────────────────

  public static show(
    context: vscode.ExtensionContext,
    policyEngine: PolicyEngine,
    agent: Agent,
    extensionUri: vscode.Uri
  ): void {
    if (OnboardingPanelProvider.currentPanel) {
      OnboardingPanelProvider.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'complyOnboarding',
      'Comply — Setup',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    OnboardingPanelProvider.currentPanel = new OnboardingPanelProvider(
      panel,
      context,
      policyEngine,
      agent,
      extensionUri
    );
  }

  public dispose(): void {
    OnboardingPanelProvider.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  // ── Message handling ────────────────────────────────────────────────────────

  private async _handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'testOrgConnection':
        await this._handleTestOrgConnection(msg.apiKey, msg.apiUrl);
        break;
      case 'testConnection':
        await this._handleTestConnection(msg.url, msg.authHeader);
        break;
      case 'save':
        await this._handleSave(msg);
        break;
    }
  }

  /**
   * Fetch the given URL, parse as JSON, validate schema.
   * Posts { type:'testResult', success, roleCount?, reason? } back.
   */
  private async _handleTestConnection(url: string, authHeader?: string): Promise<void> {
    try {
      const raw = await this._fetchUrl(url, authHeader);
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.hierarchy)) {
        this._post({ type: 'testResult', success: false, reason: 'Invalid schema — missing "hierarchy" array.' });
        return;
      }

      const roleCount: number = parsed.hierarchy.length;
      this._post({ type: 'testResult', success: true, roleCount });
    } catch (e: any) {
      const reason = e?.message?.includes('Status')
        ? `Remote policy fetch failed (returned ${e.message.split(':')[1]?.trim()})`
        : `Network error — ${e?.message ?? 'Could not reach URL'}`;
      this._post({ type: 'testResult', success: false, reason });
    }
  }

  /**
   * Test OrgAI platform API connection.
   */
  private async _handleTestOrgConnection(apiKey: string, apiUrl: string): Promise<void> {
    try {
      const client = new OrgAIClient(apiKey, apiUrl || 'https://api.orgai.dev');
      const info = await client.getOrgInfo();
      this._post({ type: 'orgTestResult', success: true, orgName: info.orgName });
    } catch (e: any) {
      this._post({ type: 'orgTestResult', success: false, reason: e.message });
    }
  }

  /**
   * Persist all settings, reload policies, close onboarding, open chat.
   */
  private async _handleSave(msg: {
    orgApiKey?: string;
    orgApiUrl?: string;
    provider: string;
    apiKey: string;
    role: string;
    url: string;
    authHeader?: string;
  }): Promise<void> {
    try {
      const cfg = vscode.workspace.getConfiguration('comply');

      // 0. Store org settings
      if (msg.orgApiKey && msg.orgApiKey.trim().length > 0) {
        await this._context.secrets.store('comply.org.apiKey', msg.orgApiKey.trim());
        if (msg.orgApiUrl && msg.orgApiUrl.trim().length > 0) {
          await cfg.update('org.apiUrl', msg.orgApiUrl.trim(), vscode.ConfigurationTarget.Global);
        }
      }

      // 1. Store provider setting
      await cfg.update('provider', msg.provider, vscode.ConfigurationTarget.Global);

      // 2. Store API key in secrets (empty string for Ollama is fine — ignored later)
      if (msg.provider !== 'ollama' && msg.apiKey.trim().length > 0) {
        await this._context.secrets.store('comply.providerApiKey', msg.apiKey.trim());
      } else if (msg.provider === 'ollama') {
        // Ensure any stale key doesn't block Ollama
        await this._context.secrets.delete('comply.providerApiKey');
      }

      // 2b. Store policy auth header
      if (msg.authHeader && msg.authHeader.trim().length > 0) {
        await this._context.secrets.store('comply.policyAuthHeader', msg.authHeader.trim());
      } else {
        await this._context.secrets.delete('comply.policyAuthHeader');
      }

      // 3. Store role setting
      await cfg.update('currentUserRole', msg.role, vscode.ConfigurationTarget.Global);

      // 4. Store policy URL
      await cfg.update('policies.url', msg.url, vscode.ConfigurationTarget.Global);

      // 5. Reload policies ─ clears cache so the newly set URL is actually fetched
      this._policyEngine.clearCache();
      await this._policyEngine.load();

      // 6. Refresh agent provider so streaming works immediately
      await this._agent.refreshProvider();
      this._agent.refreshPolicies();

      // 7. Mark setup complete
      await this._context.globalState.update('comply.setupCompleted', true);

      vscode.window.showInformationMessage('Comply: Setup complete! Welcome aboard.');

      // 8. Close onboarding, open chat
      this.dispose();
      vscode.commands.executeCommand('comply.chatView.focus');
    } catch (e: any) {
      const reason = e?.message ?? 'Unknown error — please try again.';
      this._post({ type: 'saveError', reason });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _post(msg: object): void {
    this._panel.webview.postMessage(msg);
  }

  /**
   * Fetches a URL with native https/http and returns the body as a string.
   * Follows a single redirect. Rejects on non-200 status.
   */
  private _fetchUrl(url: string, authHeader?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const lib = url.startsWith('https') ? https : http;
      const opts: https.RequestOptions | http.RequestOptions = { headers: {} };
      if (authHeader) {
        (opts.headers as any)['Authorization'] = authHeader;
      }
      lib.get(url, opts, (res: any) => {
        // Follow one redirect
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this._fetchUrl(res.headers.location, authHeader).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Status: ${res.statusCode}`));
          return;
        }
        let body = '';
        res.on('data', (chunk: any) => (body += chunk));
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });
  }

  // ── HTML generation ─────────────────────────────────────────────────────────

  private _buildHtml(): string {
    const nonce = this._getNonce();
    const styleUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css')
    );
    const onboardingUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'onboarding.html')
    );

    // Read the onboarding.html template and inject nonce + CSP
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const templatePath = path.join(this._extensionUri.fsPath, 'media', 'onboarding.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    const csp = [
      `default-src 'none';`,
      `style-src 'unsafe-inline';`,
      `script-src 'nonce-${nonce}';`,
    ].join(' ');

    html = html
      .replace('<!--CSP_META-->', `<meta http-equiv="Content-Security-Policy" content="${csp}" />`)
      .replace("nonce=\"<!--NONCE-->\"", `nonce="${nonce}"`);

    return html;
  }

  private _getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let n = '';
    for (let i = 0; i < 32; i++) n += chars[Math.floor(Math.random() * chars.length)];
    return n;
  }
}
