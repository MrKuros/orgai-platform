/* global acquireVsCodeApi */

// Acquire VS Code API (persists state across webview hide/show)
const vscode = acquireVsCodeApi();

// threads: { [threadId]: { name, messages: [{text, type}] } }
const defaultState = {
  threads: {
    default: { name: 'New Chat', messages: [] },
  },
  activeThreadId: 'default',
  hasKey: false,
};

let state = vscode.getState() || JSON.parse(JSON.stringify(defaultState));

// DOM refs
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('userInput');
const btnSend = document.getElementById('btnSend');
const btnNewThread = document.getElementById('btnNewThread');
const threadsBar = document.getElementById('threadsBar');
const streamingIndicator = document.getElementById('streamingIndicator');
const modelSelect = document.getElementById('modelSelect');
const btnCancel = document.getElementById('btnCancel');
const btnSettings = document.getElementById('btnSettings');

let isStreaming = false;
let currentAssistantBubble = null;
let streamingText = '';

function saveState() {
  vscode.setState(state);
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderThreadTabs() {
  threadsBar.querySelectorAll('.thread-tab').forEach((el) => el.remove());

  const ids = Object.keys(state.threads);
  ids.forEach((id) => {
    const thread = state.threads[id];
    const tab = document.createElement('button');
    tab.className =
      'thread-tab' + (id === state.activeThreadId ? ' active' : '');
    tab.dataset.threadId = id;

    const label = document.createElement('span');
    label.textContent = thread.name;
    tab.appendChild(label);

    if (ids.length > 1) {
      const close = document.createElement('button');
      close.className = 'close-btn';
      close.textContent = '×';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteThread(id);
      });
      tab.appendChild(close);
    }

    tab.addEventListener('click', () => switchThread(id));
    threadsBar.insertBefore(tab, btnNewThread);
  });
}

function renderWelcome() {
  const welcome = document.createElement('div');
  welcome.className = 'welcome';

  if (!state.hasKey) {
    welcome.innerHTML = `
      <div class="welcome-icon">C</div>
      <h2>Finish setup</h2>
      <p>Set an API key to start chatting.</p>
      <div style="display:flex; gap:8px; justify-content:center;">
        <button class="primary-btn" id="btnSetupKey">Set API Key</button>
      </div>
    `;
    messagesEl.appendChild(welcome);
    const btn = document.getElementById('btnSetupKey');
    if (btn) {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'openApiKeySetup' });
      });
    }
    return;
  }

  welcome.innerHTML = `
    <div class="welcome-icon">C</div>
    <h2>Comply Agent</h2>
    <p>Your org's compliance policies are active. Ask me to write code, and I'll follow the rules.</p>
    <div class="welcome-hint">Try: <kbd>"add a login endpoint"</kbd></div>
  `;
  messagesEl.appendChild(welcome);
}

function renderMessages() {
  messagesEl.innerHTML = '';
  const thread = state.threads[state.activeThreadId];

  if (!thread || thread.messages.length === 0) {
    renderWelcome();
    return;
  }

  thread.messages.forEach((msg, idx) => {
    const div = document.createElement('div');
    div.className = 'message ' + msg.type;
    if (msg.type === 'assistant') {
      div.innerHTML = formatMessageText(msg.text);
    } else {
      div.textContent = msg.text;
    }
    messagesEl.appendChild(div);

    if (idx === thread.messages.length - 1 && msg.type !== 'user' && !isStreaming) {
      const retryDiv = document.createElement('div');
      retryDiv.style.textAlign = 'right';
      
      const retryBtn = document.createElement('button');
      retryBtn.className = 'retry-btn';
      retryBtn.innerHTML = '↻ Retry';
      retryBtn.onclick = () => {
        let lastUserIdx = thread.messages.length - 1;
        while(lastUserIdx >= 0 && thread.messages[lastUserIdx].type !== 'user') {
          lastUserIdx--;
        }
        if (lastUserIdx < 0) return;
        
        let errorContext = '';
        const failedMsg = thread.messages[thread.messages.length - 1];
        if (failedMsg && (failedMsg.type === 'error' || failedMsg.type === 'blocked')) {
           errorContext = failedMsg.text;
        }

        thread.messages = thread.messages.slice(0, lastUserIdx + 1);
        saveState();
        renderMessages();
        vscode.postMessage({ 
          type: 'retryGeneration', 
          threadId: state.activeThreadId,
          errorContext 
        });
      };
      
      messagesEl.appendChild(retryDiv);
      retryDiv.appendChild(retryBtn);
    }
  });

  scrollToBottom();
}

function switchThread(threadId) {
  if (isStreaming) return;
  state.activeThreadId = threadId;
  saveState();
  renderThreadTabs();
  renderMessages();
  vscode.postMessage({ type: 'switchThread', threadId });
}

function createNewThread() {
  if (isStreaming) return;
  const id = 'thread_' + Date.now();
  const name = 'New Chat';
  state.threads[id] = { name, messages: [] };
  state.activeThreadId = id;
  saveState();
  renderThreadTabs();
  renderMessages();
  vscode.postMessage({ type: 'newThread', threadId: id });
}

function deleteThread(threadId) {
  if (isStreaming) return;
  const ids = Object.keys(state.threads);
  if (ids.length <= 1) return;

  delete state.threads[threadId];
  vscode.postMessage({ type: 'deleteThread', threadId });

  if (state.activeThreadId === threadId) {
    const remaining = Object.keys(state.threads);
    state.activeThreadId = remaining[0];
    vscode.postMessage({ type: 'switchThread', threadId: state.activeThreadId });
  }

  saveState();
  renderThreadTabs();
  renderMessages();
}

btnNewThread.addEventListener('click', createNewThread);

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || isStreaming) return;
  if (!state.hasKey) return;

  const thread = state.threads[state.activeThreadId];
  thread.messages.push({ text, type: 'user' });

  if (thread.messages.filter((m) => m.type === 'user').length === 1) {
    thread.name = text.length > 24 ? text.slice(0, 24) + '…' : text;
    renderThreadTabs();
  }

  saveState();
  renderMessages();

  vscode.postMessage({ type: 'sendMessage', text, threadId: state.activeThreadId });

  inputEl.value = '';
  inputEl.style.height = 'auto';
  btnSend.disabled = true;
}

btnSend.addEventListener('click', sendMessage);

btnCancel.addEventListener('click', () => {
  vscode.postMessage({ type: 'cancelGeneration', threadId: state.activeThreadId });
});

if (btnSettings) {
  btnSettings.addEventListener('click', () => {
    vscode.postMessage({ type: 'openApiKeySetup' });
  });
}

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  btnSend.disabled = inputEl.value.trim().length === 0 || !state.hasKey;
});

modelSelect.addEventListener('change', () => {
  vscode.postMessage({ type: 'setModel', modelId: modelSelect.value });
});

function formatMessageText(text) {
  if (!text) return text;

  const fencePattern = /```(?:json)?\s*\n?([\s\S]*?)\n?```/g;
  const collapsedPlaceholders = [];

  const withoutFences = text.replace(fencePattern, (fullMatch, body) => {
    const trimmed = body.trim();
    if (!/"tool"\s*:\s*"[^"]+"/.test(trimmed)) {
      return fullMatch;
    }
    let label = 'tool_call';
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.tool === 'run_terminal_command') {
        label = `run_terminal_command: ${(parsed.command || '').slice(0, 60)}`;
      } else if (parsed.path) {
        label = `${parsed.tool}: ${parsed.path}`;
      } else if (parsed.tool) {
        label = `${parsed.tool}`;
      }
    } catch {}
    const idx = collapsedPlaceholders.length;
    collapsedPlaceholders.push({ raw: trimmed, label });
    return `\x00TOOLCALL_${idx}\x00`;
  });

  const toolCallPattern = /\{[\s\S]*?"tool"\s*:\s*"[^"]+"[\s\S]*?\}/g;
  const collapsed = withoutFences.replace(toolCallPattern, (match) => {
    let label = 'tool_call';
    try {
      const parsed = JSON.parse(match);
      if (parsed.tool === 'run_terminal_command') {
        label = `run_terminal_command: ${(parsed.command || '').slice(0, 60)}`;
      } else if (parsed.path) {
        label = `${parsed.tool}: ${parsed.path}`;
      } else if (parsed.tool) {
        label = `${parsed.tool}`;
      }
    } catch {}
    const idx = collapsedPlaceholders.length;
    collapsedPlaceholders.push({ raw: match, label });
    return `\x00TOOLCALL_${idx}\x00`;
  });

  let html = collapsed.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  html = html.replace(/\x00TOOLCALL_(\d+)\x00/g, (_, idx) => {
    const { raw, label } = collapsedPlaceholders[Number(idx)];
    const escaped = raw.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<details class="tool-call-box"><summary>🔧 ${label}</summary><div class="tool-call-content">${escaped}</div></details>`;
  });

  html = html.replace(
    /&lt;thinking&gt;([\s\S]*?)&lt;\/thinking&gt;/g,
    (_match, p1) => {
      return `<div class="thinking-box"><div class="thinking-header">Compliance Check</div><div class="thinking-content">${p1.trim()}</div></div>`;
    }
  );

  html = html.replace(
    /```[a-z]*\n([\s\S]*?)\n```/g,
    '<pre class="code-block">$1</pre>'
  );
  html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  return html;
}

function appendLiveMessage(text, type) {
  const div = document.createElement('div');
  div.className = 'message ' + type;
  if (type === 'assistant') {
    div.innerHTML = formatMessageText(text);
  } else {
    div.textContent = text;
  }
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  const threadId = msg.threadId || state.activeThreadId;
  const thread = state.threads[threadId];
  if (!thread) return;

  const isActive = threadId === state.activeThreadId;

  switch (msg.type) {
    case 'authChanged':
      state.hasKey = !!msg.hasKey;
      saveState();
      btnSend.disabled = inputEl.value.trim().length === 0 || !state.hasKey;
      renderMessages();
      break;

    case 'streamStart':
      isStreaming = true; // Still one global streaming lock for the input UI
      if (isActive) {
        btnSend.style.display = 'none';
        btnCancel.style.display = 'flex';
        streamingIndicator.classList.add('visible');
        streamingText = '';
        currentAssistantBubble = appendLiveMessage('', 'assistant');
      }
      break;

    case 'streamToken':
      if (isActive && currentAssistantBubble) {
        streamingText += msg.token;
        currentAssistantBubble.innerHTML = formatMessageText(streamingText);
        scrollToBottom();
      } else {
        // Buffer or just wait for streamEnd
        thread._streamingText = (thread._streamingText || '') + msg.token;
      }
      break;

    case 'streamEnd':
      isStreaming = false;
      if (isActive) {
        btnSend.style.display = 'flex';
        btnCancel.style.display = 'none';
        btnSend.disabled = inputEl.value.trim().length === 0 || !state.hasKey;
        streamingIndicator.classList.remove('visible');
        if (streamingText) {
          thread.messages.push({ text: streamingText, type: 'assistant' });
          saveState();
        }
        currentAssistantBubble = null;
        streamingText = '';
        renderMessages();
      } else {
        if (thread._streamingText) {
          thread.messages.push({ text: thread._streamingText, type: 'assistant' });
          thread._streamingText = '';
          saveState();
        }
      }
      break;

    case 'blocked':
      thread.messages.push({ text: msg.message, type: 'blocked' });
      saveState();
      if (isActive) renderMessages();
      break;

    case 'toolExec':
      thread.messages.push({ text: msg.message, type: 'tool-exec' });
      saveState();
      if (isActive) renderMessages();
      break;

    case 'error':
      thread.messages.push({ text: 'Error: ' + msg.message, type: 'error' });
      saveState();
      if (isActive) {
        isStreaming = false;
        btnSend.style.display = 'flex';
        btnCancel.style.display = 'none';
        btnSend.disabled = inputEl.value.trim().length === 0 || !state.hasKey;
        streamingIndicator.classList.remove('visible');
        currentAssistantBubble = null;
        streamingText = '';
        renderMessages();
      }
      break;

    case 'streamCancelled':
      isStreaming = false;
      const cancelledMsg = msg.partial ? msg.partial : "[Generation Cancelled]";
      
      if (isActive) {
        btnSend.style.display = 'flex';
        btnCancel.style.display = 'none';
        btnSend.disabled = inputEl.value.trim().length === 0 || !state.hasKey;
        streamingIndicator.classList.remove('visible');
        
        if (currentAssistantBubble) {
          currentAssistantBubble.innerHTML = formatMessageText(cancelledMsg);
        } else {
          appendLiveMessage(cancelledMsg, 'assistant');
        }

        thread.messages.push({ text: cancelledMsg, type: 'assistant' });
        saveState();
        currentAssistantBubble = null;
        streamingText = '';
        renderMessages();
      } else {
        thread.messages.push({ text: cancelledMsg, type: 'assistant' });
        thread._streamingText = '';
        saveState();
      }
      break;

    case 'modelConfig':
      modelSelect.innerHTML = '';
      const models = Array.isArray(msg.models) ? msg.models : [];
      // If provider doesn't supply a model list, keep a single option so the UI isn't empty.
      if (models.length === 0) {
        const current = typeof msg.currentModel === 'string' ? msg.currentModel : '';
        const opt = document.createElement('option');
        opt.value = current || 'model';
        opt.textContent = current || 'Model';
        opt.selected = true;
        modelSelect.appendChild(opt);
        break;
      }

      models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        if (m.id === msg.currentModel) opt.selected = true;
        modelSelect.appendChild(opt);
      });
      break;
  }
});

renderThreadTabs();
renderMessages();
vscode.postMessage({ type: 'switchThread', threadId: state.activeThreadId });
vscode.postMessage({ type: 'ready' });

