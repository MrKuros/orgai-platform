import * as vscode from 'vscode';
import { Agent } from '../agent';

/**
 * Provides the sidebar webview panel for the Comply chat UI.
 */
export class ComplyPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'comply.chatView';
  private view?: vscode.WebviewView;
  private agent: Agent;

  constructor(
    private readonly extensionUri: vscode.Uri,
    agent: Agent
  ) {
    this.agent = agent;
  }

  public notifyAuthChanged(hasKey: boolean): void {
    this.postMessage({ type: 'authChanged', hasKey });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    const webview = webviewView.webview;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    // Set the webview HTML (CSP-safe; no inline scripts)
    webview.html = this.getHtml(webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'ready':
          // Webview JS is loaded — now safe to send model config
          this.postMessage({
            type: 'modelConfig',
            models: await this.agent.getAvailableModels(),
            currentModel: this.agent.getModel(),
          });
          this.postMessage({
            type: 'authChanged',
            hasKey: this.agent.hasApiKey(),
          });
          break;
        case 'sendMessage':
          await this.handleUserMessage(message.text, message.threadId);
          break;
        case 'switchThread':
          this.agent.switchThread(message.threadId);
          break;
        case 'newThread':
          this.agent.createThread(message.threadId);
          break;
        case 'deleteThread':
          this.agent.deleteThread(message.threadId);
          break;
        case 'setModel':
          this.agent.setModel(message.modelId);
          break;
        case 'cancelGeneration':
          this.agent.cancel(message.threadId);
          break;
        case 'retryGeneration':
          await this.handleRetry(message.threadId, message.errorContext);
          break;
        case 'openApiKeySetup':
          vscode.commands.executeCommand('comply.openSetup');
          break;
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'styles.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js')
    );

    const csp = [
      `default-src 'none';`,
      `img-src ${webview.cspSource} https: data:;`,
      `style-src ${webview.cspSource};`,
      `script-src 'nonce-${nonce}';`,
    ].join(' ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>Comply Chat</title>
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="header-left">
          <div class="header-logo">C</div>
          <div class="header-title">Comply</div>
        </div>
        <div class="model-selector">
          <select id="modelSelect" title="Choose model">
            <option value="llama-3.3-70b-versatile">Llama 3.3 70B</option>
          </select>
        </div>
        <button class="settings-btn" id="btnSettings" title="Settings">
          ⚙️
        </button>
      </div>

      <div class="threads-bar" id="threadsBar">
        <button class="btn-new-thread" id="btnNewThread" title="New thread">+</button>
      </div>

      <div class="messages" id="messages"></div>

      <div class="streaming-indicator" id="streamingIndicator">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>

      <div class="input-area">
        <div class="input-wrapper">
          <textarea id="userInput" placeholder="Describe a coding task…" rows="1"></textarea>
          <button class="btn-send" id="btnSend" title="Send message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
          <button class="btn-cancel" id="btnCancel" title="Stop generation" style="display: none;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <rect x="6" y="6" width="12" height="12" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private getNonce(): string {
    const possible =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private async handleUserMessage(text: string, threadId: string): Promise<void> {
    if (!this.view) {return;}

    // Ensure we're on the correct thread
    this.agent.switchThread(threadId);

    // Signal streaming start
    this.postMessage({ type: 'streamStart', threadId });

    await this.agent.chat(threadId, text, {
      onToken: (token) => {
        this.postMessage({ type: 'streamToken', threadId, token });
      },
      onComplete: (_fullText) => {
        this.postMessage({ type: 'streamEnd', threadId });
      },
      onError: (error) => {
        this.postMessage({ type: 'error', threadId, message: error });
      },
      onBlocked: (message) => {
        this.postMessage({ type: 'blocked', threadId, message });
      },
      onToolExec: (description) => {
        this.postMessage({ type: 'toolExec', threadId, message: description });
      },
      onCancelled: (partial) => {
        this.postMessage({ type: 'streamCancelled', threadId, partial });
      },
    });
  }

  private async handleRetry(threadId: string, errorContext?: string): Promise<void> {
    if (!this.view) {return;}

    this.agent.switchThread(threadId);
    this.postMessage({ type: 'streamStart', threadId });

    await this.agent.retry(threadId, {
      onToken: (token) => {
        this.postMessage({ type: 'streamToken', threadId, token });
      },
      onComplete: (_fullText) => {
        this.postMessage({ type: 'streamEnd', threadId });
      },
      onError: (error) => {
        this.postMessage({ type: 'error', threadId, message: error });
      },
      onBlocked: (message) => {
        this.postMessage({ type: 'blocked', threadId, message });
      },
      onToolExec: (description) => {
        this.postMessage({ type: 'toolExec', threadId, message: description });
      },
      onCancelled: (partial) => {
        this.postMessage({ type: 'streamCancelled', threadId, partial });
      },
    }, errorContext);
  }

  private postMessage(message: any): void {
    this.view?.webview.postMessage(message);
  }
}
