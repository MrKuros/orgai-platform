import * as vscode from 'vscode';
import { PolicyEngine } from '../policyEngine';
import { Agent } from '../agent';

import { GroqClient } from '../llm/providers/groq';
import { OpenAiCompatibleClient } from '../llm/providers/openaiCompatible';
import { AnthropicClient } from '../llm/providers/anthropic';
import { GeminiClient } from '../llm/providers/gemini';

export class SetupPanel {
  public static currentPanel: SetupPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private context: vscode.ExtensionContext,
    private policyEngine: PolicyEngine,
    private agent: Agent
  ) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._initHtml();
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === 'fetchModels') {
          const { provider, apiKey } = message;
          let client: any = null;
          const timeoutMs = 15000;
          switch (provider) {
            case 'groq': client = new GroqClient({ apiKey }); break;
            case 'openai': client = new OpenAiCompatibleClient({ id: 'openai', apiKey, baseUrl: 'https://api.openai.com/v1', timeoutMs }); break;
            case 'anthropic': client = new AnthropicClient({ apiKey, timeoutMs }); break;
            case 'gemini': client = new GeminiClient({ apiKey, timeoutMs }); break;
          }
          if (client) {
            try {
              const models = await client.getAvailableModels();
              this._panel.webview.postMessage({ command: 'modelsFetched', models });
            } catch (e) {
              this._panel.webview.postMessage({ command: 'modelsError', error: String(e) });
            }
          }
        }

        if (message.command === 'saveSetup') {
          const { provider, apiKey, model, role, maxFixAttempts } = message;
          
          const cfg = vscode.workspace.getConfiguration('comply');
          await cfg.update('llm.provider', provider, vscode.ConfigurationTarget.Global);
          if (maxFixAttempts !== undefined) {
            await cfg.update('llm.maxFixAttempts', Number(maxFixAttempts), vscode.ConfigurationTarget.Global);
          }
          if (model) {
            await cfg.update('llm.model', model, vscode.ConfigurationTarget.Global);
          }
          if (message.policyUrl !== undefined) {
            await cfg.update('policies.url', message.policyUrl, vscode.ConfigurationTarget.Global);
          }

          if (apiKey && apiKey.trim().length > 0) {
            await this.context.secrets.store(`comply.apiKey.${provider}`, apiKey.trim());
          }

          if (message.authHeader !== undefined) {
            if (message.authHeader.trim().length > 0) {
              await this.context.secrets.store('comply.policyAuthHeader', message.authHeader.trim());
            } else {
              await this.context.secrets.delete('comply.policyAuthHeader');
            }
          }
          
          await this.agent.refreshProvider();

          if (role) {
            await this.policyEngine.saveRole(role);
            
            // Reload policies so the new URL config takes effect
            this.policyEngine.clearCache();
            await this.policyEngine.load();
            this.agent.refreshPolicies();
          }

          await this.context.globalState.update('comply.setupCompleted', true);

          vscode.window.showInformationMessage('Comply: Setup complete!');
          this._panel.dispose();
          
          vscode.commands.executeCommand('comply.chatView.focus');
        }
      },
      null,
      this._disposables
    );
  }

  public static show(
    context: vscode.ExtensionContext,
    policyEngine: PolicyEngine,
    agent: Agent
  ) {
    if (SetupPanel.currentPanel) {
      SetupPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'complySetup',
      'Comply Setup',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    SetupPanel.currentPanel = new SetupPanel(panel, context, policyEngine, agent);
  }

  private async _initHtml() {
    const cfg = vscode.workspace.getConfiguration('comply');
    const provider = cfg.get<string>('llm.provider') || 'groq';
    const maxFixAttempts = cfg.get<number>('llm.maxFixAttempts') ?? 3;
    const policyUrl = cfg.get<string>('policies.url') || '';
    
    let apiKey = '';
    try {
      apiKey = await this.context.secrets.get(`comply.apiKey.${provider}`) || '';
    } catch {}

    let authHeader = '';
    try {
      authHeader = await this.context.secrets.get('comply.policyAuthHeader') || '';
    } catch {}

    this._panel.webview.html = this._getHtmlForWebview(provider, apiKey, maxFixAttempts, policyUrl, authHeader);
  }

  private _getHtmlForWebview(currentProvider: string = 'groq', currentApiKey: string = '', currentMaxFixAttempts: number = 3, currentPolicyUrl: string = '', currentAuthHeader: string = '') {
    const roles = this.policyEngine.getAllRoles();
    const roleOptions = roles
      .map((r) => `<option value="${r.role}">${r.displayName}</option>`)
      .join('\n');
    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Comply Setup</title>
          <style>
              body { 
                  padding: 20px; 
                  color: var(--vscode-foreground); 
                  font-family: var(--vscode-font-family);
                  font-size: var(--vscode-font-size, 13px);
              }
              h2 { 
                  margin-top: 0;
                  margin-bottom: 12px; 
                  font-size: 1.25em;
                  font-weight: normal;
              }
              p {
                  margin-bottom: 24px;
                  color: var(--vscode-descriptionForeground);
                  line-height: 1.4;
              }
              .field { 
                  margin-bottom: 16px; 
              }
              label { 
                  display: block; 
                  margin-bottom: 6px; 
                  font-size: var(--vscode-font-size, 13px);
              }
              input, select { 
                  width: 100%; 
                  max-width: 400px;
                  padding: 6px; 
                  box-sizing: border-box; 
                  background: var(--vscode-input-background); 
                  color: var(--vscode-input-foreground); 
                  border: 1px solid var(--vscode-input-border); 
                  border-radius: 2px;
                  font-family: var(--vscode-font-family);
                  font-size: var(--vscode-font-size, 13px);
                  outline: none;
              }
              input:focus, select:focus {
                  border-color: var(--vscode-focusBorder);
                  outline: 1px solid var(--vscode-focusBorder);
                  outline-offset: -1px;
              }
              button { 
                  background-color: var(--vscode-button-background); 
                  color: var(--vscode-button-foreground); 
                  border: none; 
                  padding: 6px 14px; 
                  cursor: pointer; 
                  border-radius: 2px; 
                  font-size: var(--vscode-font-size, 13px);
                  margin-top: 8px;
              }
              button:hover { 
                  background-color: var(--vscode-button-hoverBackground); 
              }
              button:focus {
                  outline: 1px solid var(--vscode-focusBorder);
                  outline-offset: 2px;
              }
          </style>
      </head>
      <body>
          <h2>Welcome to Comply</h2>
          <p>Please complete this one-time setup to get started. You can change these settings later via VS Code commands or the configuration file.</p>
          
          <div class="field">
              <label for="provider">LLM Provider</label>
              <select id="provider">
                  <option value="groq" ${currentProvider === 'groq' ? 'selected' : ''}>Groq</option>
                  <option value="openai" ${currentProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
                  <option value="anthropic" ${currentProvider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
                  <option value="gemini" ${currentProvider === 'gemini' ? 'selected' : ''}>Gemini</option>
              </select>
          </div>
          
          <div class="field">
              <label for="apiKey">API Key</label>
              <input type="password" id="apiKey" placeholder="Enter your API key..." value="${currentApiKey}" />
          </div>

          <div class="field" id="modelField" style="display: none;">
              <label for="model">Model</label>
              <select id="model"></select>
          </div>

          <div class="field">
              <button id="fetchModelsBtn">Fetch Models</button>
              <span id="fetchStatus" style="font-size: 11px; margin-left: 8px; color: var(--vscode-descriptionForeground);"></span>
          </div>

          <div class="field">
              <label for="role">Your Role</label>
              <select id="role">
                  ${roleOptions}
              </select>
          </div>

          <div class="field">
              <label for="policyUrl">Policy JSON Source URL</label>
              <input type="text" id="policyUrl" placeholder="https://..." value="${currentPolicyUrl}" />
          </div>

          <div class="field">
              <label for="authHeader">Authorization Header Value (optional)</label>
              <input type="password" id="authHeader" placeholder="Paste Authorization header..." value="${currentAuthHeader}" />
              <div style="font-size: 11px; margin-top: 4px; color: var(--vscode-descriptionForeground);">e.g. token ghp_xxx</div>
          </div>

          <div class="field">
              <label for="maxFixAttempts">Max Auto-fix Attempts (1-10)</label>
              <input type="number" id="maxFixAttempts" min="1" max="10" value="${currentMaxFixAttempts}" />
          </div>
          <button id="saveBtn" style="margin-top: 16px;">Save & Continue</button>

          <script>
              const vscode = acquireVsCodeApi();
              
              const providerSelect = document.getElementById('provider');
              const apiKeyInput = document.getElementById('apiKey');
              const fetchModelsBtn = document.getElementById('fetchModelsBtn');
              const fetchStatus = document.getElementById('fetchStatus');
              const modelField = document.getElementById('modelField');
              const modelSelect = document.getElementById('model');
              const saveBtn = document.getElementById('saveBtn');
              const roleSelect = document.getElementById('role');
              const policyUrlInput = document.getElementById('policyUrl');
              const authHeaderInput = document.getElementById('authHeader');
              const maxFixAttemptsInput = document.getElementById('maxFixAttempts');

              fetchModelsBtn.addEventListener('click', () => {
                  const provider = providerSelect.value;
                  const apiKey = apiKeyInput.value.trim();
                  
                  if (!apiKey) {
                      fetchStatus.textContent = 'Please enter an API key first.';
                      fetchStatus.style.color = 'var(--vscode-errorForeground)';
                      return;
                  }
                  
                  fetchStatus.textContent = 'Fetching models...';
                  fetchStatus.style.color = 'var(--vscode-descriptionForeground)';
                  fetchModelsBtn.disabled = true;
                  
                  vscode.postMessage({ command: 'fetchModels', provider, apiKey });
              });

              window.addEventListener('message', event => {
                  const message = event.data;
                  if (message.command === 'modelsFetched') {
                      fetchModelsBtn.disabled = false;
                      fetchStatus.textContent = 'Models loaded successfully!';
                      fetchStatus.style.color = 'var(--vscode-testing-iconPassed)';
                      
                      modelSelect.innerHTML = '';
                      message.models.forEach(m => {
                          const opt = document.createElement('option');
                          opt.value = m.id;
                          opt.textContent = m.label;
                          modelSelect.appendChild(opt);
                      });
                      
                      modelField.style.display = 'block';
                  } else if (message.command === 'modelsError') {
                      fetchModelsBtn.disabled = false;
                      fetchStatus.textContent = 'Error fetching models. Using defaults.';
                      fetchStatus.style.color = 'var(--vscode-errorForeground)';
                  }
              });

              saveBtn.addEventListener('click', () => {
                  const provider = providerSelect.value;
                  const apiKey = apiKeyInput.value.trim();
                  const role = roleSelect.value;
                  const maxFixAttempts = parseInt(maxFixAttemptsInput.value);
                  const model = modelField.style.display !== 'none' ? modelSelect.value : undefined;
                  const policyUrl = policyUrlInput.value.trim();
                  const authHeader = authHeaderInput.value.trim();
                  
                  if (!apiKey && provider !== 'ollama') {
                      return;
                  }

                  vscode.postMessage({ command: 'saveSetup', provider, apiKey, model, role, maxFixAttempts, policyUrl, authHeader });
              });
          </script>
      </body>
      </html>
    `;
  }

  public dispose() {
    SetupPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {x.dispose();}
    }
  }
}
