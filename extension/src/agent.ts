import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { Evaluator } from '@comply/core';
import { PolicyEngine } from './policyEngine';
import type { ChatMessage, LlmClient, LlmProviderId } from './llm/types';
import { createLlmClient, type ProviderSecrets } from './llm/factory';

interface ToolCall {
  tool: 'write_file' | 'run_terminal_command';
  path?: string;
  content?: string;
  command?: string;
}

interface StreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: string) => void;
  onBlocked: (message: string) => void;
  onToolExec: (description: string) => void;
  onCancelled?: (partialText?: string) => void;
}



type Message = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * Agent handles LLM calls via Groq with streaming,
 * policy injection, and post-stream evaluation.
 * Supports multiple conversation threads.
 */
export class Agent {
  private llm: LlmClient | null = null;
  private provider: LlmProviderId = 'groq';
  private secrets: ProviderSecrets;
  private threads: Map<string, Message[]> = new Map();
  private activeThreadId: string = 'default';
  private policyEngine: PolicyEngine;
  private evaluator: Evaluator;
  private model: string;
  private output?: vscode.OutputChannel;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(opts: {
    policyEngine: PolicyEngine;
    output?: vscode.OutputChannel;
    secrets: ProviderSecrets;
  }) {
    this.policyEngine = opts.policyEngine;
    this.output = opts.output;
    this.secrets = opts.secrets;
    this.model =
      vscode.workspace.getConfiguration('comply').get<string>('llm.model') ??
      'llama-3.3-70b-versatile';

    // Provider is configured async; call init() after construction
    this.evaluator = new Evaluator(this.policyEngine.getResolvedPolicies());

    // Create the default thread
    this.createThread('default');

    // Avoid dumping prompts/policies to logs in production by default
    this.output?.appendLine('[Comply] Agent initialized.');
  }

  public async init(): Promise<void> {
    const { client, provider } = await createLlmClient(this.secrets);
    this.llm = client;
    this.provider = provider;
    this.output?.appendLine(
      client
        ? `[Comply] LLM provider ready: ${provider}`
        : `[Comply] No API key configured for provider: ${provider}`
    );
  }

  public hasApiKey(): boolean {
    return !!this.llm;
  }

  public async refreshProvider(): Promise<void> {
    await this.init();
  }

  public refreshPolicies(): void {
    // Rebuild evaluator + ensure new threads start with latest system prompt
    this.evaluator = new Evaluator(this.policyEngine.getResolvedPolicies());
    // Note: existing threads keep their initial system prompt for continuity.
    // Users can start a new thread to pick up updated policies.
  }

  /** Get a thread's message history. */
  private getThreadHistory(threadId: string): Message[] {
    let history = this.threads.get(threadId);
    if (!history) {
      this.createThread(threadId);
      history = this.threads.get(threadId)!;
    }
    return history;
  }

  /** Create a new thread with the system prompt. */
  public createThread(threadId: string): void {
    const systemPrompt = this.policyEngine.getSystemPrompt();
    const messages: Message[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }]
      : [];
    this.threads.set(threadId, messages);
    this.activeThreadId = threadId;
  }

  /** Switch to an existing thread. */
  public switchThread(threadId: string): void {
    if (!this.threads.has(threadId)) {
      this.createThread(threadId);
    }
    this.activeThreadId = threadId;
  }

  /** Set the active model. */
  public setModel(modelId: string): void {
    this.model = modelId;
    this.output?.appendLine(`[Comply] Model switched to: ${modelId}`);
    // Persist to settings for provider-agnostic UX
    void vscode.workspace
      .getConfiguration('comply')
      .update('llm.model', modelId, vscode.ConfigurationTarget.Global);
  }

  /** Get the current model id. */
  public getModel(): string {
    return this.model;
  }

  /** Return the list of available models for the UI asynchronously. */
  public async getAvailableModels(): Promise<{ id: string; label: string }[]> {
    if (this.llm) {
      try {
        const models = await this.llm.getAvailableModels();
        if (models && models.length > 0) return models;
      } catch (e) {
        console.error('Failed to fetch models from provider API', e);
      }
    }
    
    // Fallbacks if client is not instantiated or failed
    if (this.provider === 'groq') {
      return [
        { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
        { id: 'llama3-8b-8192', label: 'Llama 3 8B' },
        { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
        { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
        { id: 'gemma2-9b-it', label: 'Gemma 2 9B' }
      ];
    } else if (this.provider === 'openai') {
      return [
        { id: 'gpt-4o', label: 'GPT-4o' },
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini' }
      ];
    } else if (this.provider === 'anthropic') {
      return [
        { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' }
      ];
    } else if (this.provider === 'gemini') {
      return [
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }
      ];
    } else if (this.provider === 'ollama') {
      return [
        { id: 'llama3.2', label: 'Llama 3.2 (3B)' },
        { id: 'llama3.1', label: 'Llama 3.1 (8B)' },
        { id: 'llama3.1:70b', label: 'Llama 3.1 (70B)' },
        { id: 'codellama', label: 'Code Llama' },
        { id: 'deepseek-coder-v2', label: 'DeepSeek Coder V2' },
        { id: 'qwen2.5-coder', label: 'Qwen 2.5 Coder' },
        { id: 'mistral', label: 'Mistral 7B' },
      ];
    }
    return [{ id: this.model, label: this.model }];
  }

  /** Delete a thread. */
  public deleteThread(threadId: string): void {
    this.threads.delete(threadId);
    if (this.activeThreadId === threadId) {
      // Switch to first available or create default
      const first = this.threads.keys().next().value;
      this.activeThreadId = first ?? 'default';
      if (!this.threads.has(this.activeThreadId)) {
        this.createThread(this.activeThreadId);
      }
    }
  }

  /**
   * Build a simple file tree string for the workspace root (2 levels deep).
   */
  private async getWorkspaceTree(signal?: AbortSignal): Promise<string> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {return '(no workspace open)';}
    const root = folders[0].uri.fsPath;
    const fs = require('fs').promises as typeof import('fs/promises');
    const IGNORE = new Set(['node_modules', '.git', 'out', 'dist', '.vscode']);

    async function walk(dir: string, prefix: string, depth: number): Promise<string[]> {
      if (depth > 2 || signal?.aborted) {return [];}
      let entries: string[];
      try { entries = await fs.readdir(dir); } catch { return []; }
      const lines: string[] = [];
      for (const entry of entries) {
        if (signal?.aborted) break;
        if (IGNORE.has(entry) || entry.startsWith('.')) {continue;}
        const full = path.join(dir, entry);
        let isDir = false;
        try { 
          const stat = await fs.stat(full);
          isDir = stat.isDirectory();
        } catch { continue; }
        lines.push(prefix + (isDir ? '📁 ' : '📄 ') + entry);
        if (isDir) {
          const subLines = await walk(full, prefix + '  ', depth + 1);
          lines.push(...subLines);
        }
      }
      return lines;
    }

    const tree = await walk(root, '', 0);
    return `Workspace root: ${root}\n${tree.join('\n') || '(empty)'}\n`;
  }

  /**
   * Get contents of all .ts files in the workspace so the model has
   * full context and never creates files that already exist.
   * Walks the entire workspace tree recursively, skipping common
   * non-source directories.
   */
  private getSrcFilesContent(root: string): string {
    const fs = require('fs') as typeof import('fs');
    const IGNORE = new Set(['node_modules', '.git', 'out', 'dist', '.vscode']);

    let result = '\nCurrent workspace files:\n\n';

    /**
     * Recursively collect all .ts files under `dir`.
     */
    const walkTs = (dir: string): void => {
      let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) as any; } catch { return; }

      for (const entry of entries) {
        if (IGNORE.has(entry.name) || entry.name.startsWith('.')) { continue; }
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walkTs(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          // Build a workspace-relative path for the header
          const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            result += `--- ${relPath} ---\n${content}\n\n`;
          } catch {}
        }
      }
    };

    walkTs(root);

    // Detect the logger file at the workspace root so the LLM
    // uses the correct relative import path in any file under src/.
    // e.g. logger.ts lives at <root>/logger.ts → import from '../logger'
    const srcDir = path.join(root, 'src');
    const loggerCandidates = ['logger.ts', 'logger.js', 'logger-server.ts'];
    for (const candidate of loggerCandidates) {
      const loggerAbs = path.join(root, candidate);
      if (fs.existsSync(loggerAbs)) {
        // path.relative gives e.g. '../logger.ts' — strip the extension
        const relWithExt = path.relative(srcDir, loggerAbs).replace(/\\/g, '/');
        const relImport = relWithExt.replace(/\.(ts|js)$/, '');
        result += `[Import Path Note] The logger module is at the workspace root.\n`;
        result += `Files inside src/ MUST import it as: import { logger } from '${relImport}';\n\n`;
        break;
      }
    }

    return result;
  }

  /**
   * Send a user message and stream the response back.
   */
  public async chat(
    threadId: string,
    userMessage: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    // Bug 1: Init controller at the VERY start
    const controller = new AbortController();
    this.abortControllers.set(threadId, controller);
    const signal = controller.signal;

    if (!this.llm) {
      callbacks.onError('Comply is not configured. Run "Comply: Set API Key" to start.');
      this.abortControllers.delete(threadId);
      return;
    }

    // Prepend workspace context to every user message

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const workspaceTree = await this.getWorkspaceTree(signal);
    if (signal.aborted) throw { name: 'AbortError' };

    const mode = vscode.workspace.getConfiguration('comply').get<string>('context.mode') ?? 'tree';
    const srcContent =
      mode === 'fullTs' && workspaceRoot
        ? await this.getSrcFilesContentBounded(workspaceRoot, signal)
        : '';
    if (signal.aborted) throw { name: 'AbortError' };

    // Save only the raw user message to the history so it doesn't blow up context limits over time
    const history = this.getThreadHistory(threadId);
    history.push({
      role: 'user',
      content: userMessage,
    });

    // Build context-injected messages array for this specific API call
    const messagesForApi: ChatMessage[] = [...history];
    messagesForApi[messagesForApi.length - 1] = {
      role: 'user',
      content: [
        `[WORKSPACE FILE TREE]`,
        workspaceTree,
        srcContent ? `[WORKSPACE SOURCE CONTEXT]\n${srcContent}` : '',
        `[USER REQUEST]`,
        userMessage,
      ].join('\n'),
    };

    let fullResponse = '';
    try {
      fullResponse = await this.llm.chatStream(
        {
          model: this.model,
          messages: messagesForApi,
          temperature: 0.7,
          maxTokens: 4096,
        },
        { onToken: (t) => {
            fullResponse += t;
            callbacks.onToken(t);
        }, onCancelled: callbacks.onCancelled },
        this.abortControllers.get(threadId)?.signal
      );

      // Store assistant response in history
      history.push({
        role: 'assistant',
        content: fullResponse,
      });

      // Parse and evaluate any tool calls in the response
      const toolCalls = this.parseToolCalls(fullResponse);

      if (controller.signal.aborted) {
        throw { name: 'AbortError' };
      }

      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          if (controller.signal.aborted) {
            throw { name: 'AbortError' };
          }
          await this.executeToolCall(threadId, toolCall, callbacks);
        }
      }

      if (controller.signal.aborted) {
        throw { name: 'AbortError' };
      }
      callbacks.onComplete(fullResponse);
    } catch (error: any) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        // Mark as interrupted and save to history
        const interruptedText = fullResponse + '\n\n[Interrupted]';
        history.push({
          role: 'assistant',
          content: interruptedText,
        });
        callbacks.onCancelled?.(interruptedText);
      } else {
        const msg = error?.message ?? 'Unknown error calling API';
        callbacks.onError(msg);
      }
    } finally {
      this.abortControllers.delete(threadId);
    }
  }

  /** Cancel an ongoing generation */
  public cancel(threadId: string): void {
    const controller = this.abortControllers.get(threadId);
    if (controller) {
      controller.abort();
    }
  }

  /** Retry the last generation */
  public async retry(threadId: string, callbacks: StreamCallbacks, errorContext?: string): Promise<void> {
    const history = this.getThreadHistory(threadId);
    if (history.length === 0) return;
    
    // Find last user message by discarding everything after it
    while (history.length > 0 && history[history.length - 1].role !== 'user') {
      history.pop();
    }
    
    const lastUserMsg = history.pop();
    if (!lastUserMsg) return;
    
    let contentToRetry = lastUserMsg.content;
    if (errorContext && errorContext.trim() !== '') {
      contentToRetry += `\n\n[SYSTEM WARNING: Your previous attempt failed or was interrupted with this error. Please fix your response:]\n${errorContext}`;
    }

    // Re-run
    await this.chat(threadId, contentToRetry, callbacks);
  }

  /**
   * Bounded source-context provider for enterprise safety.
   * Collects TypeScript files but caps total bytes to reduce data exfil risk and latency.
   */
  private async getSrcFilesContentBounded(root: string, signal?: AbortSignal): Promise<string> {
    const fs = require('fs').promises as typeof import('fs/promises');
    const IGNORE = new Set(['node_modules', '.git', 'out', 'dist', '.vscode']);
    const MAX_BYTES = 200_000; // ~200KB of source context

    let result = '';
    let used = 0;

    const walk = async (dir: string): Promise<void> => {
      if (signal?.aborted) return;
      let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true }) as any;
      } catch {
        return;
      }

      for (const entry of entries) {
        if (signal?.aborted) break;
        if (IGNORE.has(entry.name) || entry.name.startsWith('.')) continue;
        if (used >= MAX_BYTES) return;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
          if (used >= MAX_BYTES) return;
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            const block = `--- ${relPath} ---\n${content}\n\n`;
            const bytes = Buffer.byteLength(block, 'utf8');
            if (used + bytes > MAX_BYTES) return;
            result += block;
            used += bytes;
          } catch {}
        }
      }
    };

    await walk(root);
    if (!result) return '';
    return `Current workspace TypeScript (bounded to ${MAX_BYTES} bytes):\n\n${result}`;
  }

  /**
   * Parse JSON tool-call blocks from the LLM response.
   * Extracts valid JSON blocks where tool is write_file or run_terminal_command.
   */
  private parseToolCalls(response: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const jsonRegex = /```json\s*\n?([\s\S]*?)\n?```/g;
    let match;

    while ((match = jsonRegex.exec(response)) !== null) {
      const jsonStr = match[1].trim();
      try {
        const parsed = JSON.parse(jsonStr);
        if (
          parsed &&
          typeof parsed === 'object' &&
          (parsed.tool === 'write_file' || parsed.tool === 'run_terminal_command')
        ) {
          toolCalls.push(parsed as ToolCall);
        }
      } catch {
        // Silently skip any block that fails to parse
      }
    }

    // Also look for raw JSON blocks if they aren't fenced (fallback)
    const rawJsonRegex = /\{[\s\S]*?"tool"\s*:\s*"[^"]+"[\s\S]*?\}/g;
    while ((match = rawJsonRegex.exec(response)) !== null) {
      // If this match was already caught by the fenced regex, skip it
      const start = match.index;
      const alreadyCaught = toolCalls.some(tc => response.includes(JSON.stringify(tc), start - 10));
      if (alreadyCaught) continue;

      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.tool === 'write_file' || parsed.tool === 'run_terminal_command') {
          toolCalls.push(parsed as ToolCall);
        }
      } catch {
        // Skip
      }
    }

    return toolCalls;
  }

  /**
   * Execute a single tool call after running evaluator checks.
   */
  private async executeToolCall(
    threadId: string,
    toolCall: ToolCall,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const history = this.getThreadHistory(threadId);
    if (toolCall.tool === 'write_file' && toolCall.path && toolCall.content) {
      // Evaluate the proposed code
      const violations = this.evaluator.evaluateCode(
        toolCall.content,
        toolCall.path
      );

      const errors = violations.filter(v => v.severity === 'error');
      const warnings = violations.filter(v => v.severity === 'warning');

      if (errors.length > 0) {
        const blockedMsg = Evaluator.formatViolations(errors);
        callbacks.onBlocked(blockedMsg);

        // After blocking a violation — fire and forget, never block the UI
        const orgClient = this.policyEngine.getOrgClient();
        const orgId = this.policyEngine.getOrgId();
        if (orgClient && orgId) {
          orgClient.reportViolation(orgId, {
            type: 'code',
            content: toolCall.content!.substring(0, 500),
            filePath: toolCall.path,
            roleName: this.policyEngine.getCurrentRole()
          }).catch((err: any) => this.output?.appendLine(`[Comply] Failed to report violation: ${err.message}`));
        }

        // Feed violation context back into history so the user can say "fix it"
        history.push({
          role: 'assistant',
          content: `[COMPLIANCE BLOCK] My proposed file "${toolCall.path}" was blocked:\n${blockedMsg}\n\nI need to rewrite this code to comply with the policies when asked.`,
        });
        return;
      }

      if (warnings.length > 0) {
        callbacks.onToolExec(Evaluator.formatViolations(warnings));
      }

      // Safe — write the file
      const fullPath = await this.writeFile(threadId, toolCall.path, toolCall.content, callbacks);
      if (!fullPath) {return;}

      // Run compile check and auto-fix loop
      await this.compileCheckLoop(threadId, toolCall.path, toolCall.content, fullPath, callbacks);

    } else if (toolCall.tool === 'run_terminal_command' && toolCall.command) {
      // Evaluate the proposed command
      const violations = this.evaluator.evaluateCommand(toolCall.command);

      const errors = violations.filter(v => v.severity === 'error');
      const warnings = violations.filter(v => v.severity === 'warning');

      if (errors.length > 0) {
        const blockedMsg = Evaluator.formatViolations(errors);
        callbacks.onBlocked(blockedMsg);

        // After blocking a violation — fire and forget, never block the UI
        const orgClient = this.policyEngine.getOrgClient();
        const orgId = this.policyEngine.getOrgId();
        if (orgClient && orgId) {
          orgClient.reportViolation(orgId, {
            type: 'command',
            content: toolCall.command!.substring(0, 500),
            filePath: toolCall.path,
            roleName: this.policyEngine.getCurrentRole()
          }).catch((err: any) => this.output?.appendLine(`[Comply] Failed to report violation: ${err.message}`));
        }

        // Feed violation context back into history so the user can say "fix it"
        history.push({
          role: 'assistant',
          content: `[COMPLIANCE BLOCK] My proposed command "${toolCall.command}" was blocked:\n${blockedMsg}\n\nI need to use an approved alternative when asked.`,
        });
        return;
      }

      if (warnings.length > 0) {
        callbacks.onToolExec(Evaluator.formatViolations(warnings));
      }

      // Safe — run via VS Code terminal
      try {
        let terminal = vscode.window.terminals.find(t => t.name === 'Comply Agent');
        if (!terminal) {
          terminal = vscode.window.createTerminal('Comply Agent');
        }
        terminal.show(true);
        terminal.sendText(toolCall.command);
        callbacks.onToolExec(`✅ Ran command: ${toolCall.command}`);
      } catch (err: any) {
        callbacks.onError(`Failed to run command: ${err.message}`);
      }
    }
  }

  /**
   * Write a file to the workspace. Returns the full path on success, null on failure.
   */
  private async writeFile(
    threadId: string,
    filePath: string,
    content: string,
    callbacks: StreamCallbacks
  ): Promise<string | null> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        callbacks.onError('No workspace folder open.');
        return null;
      }
      const rootPath = workspaceFolders[0].uri.fsPath;
      const fullPath = path.join(rootPath, filePath);

      if (!this.isSubpath(fullPath, rootPath)) {
        callbacks.onError('Blocked: path traversal detected');
        return null;
      }

      const fullUri = vscode.Uri.file(fullPath);

      // Ensure parent directory exists
      const dirUri = vscode.Uri.file(path.dirname(fullPath));
      await vscode.workspace.fs.createDirectory(dirUri);

      await vscode.workspace.fs.writeFile(
        fullUri,
        Buffer.from(content, 'utf-8')
      );
      callbacks.onToolExec(`✅ Wrote file: ${filePath}`);
      return fullPath;
    } catch (err: any) {
      callbacks.onError(`Failed to write file: ${err.message}`);
      return null;
    }
  }

  private isSubpath(child: string, parent: string): boolean {
    const relative = path.relative(parent, child);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  /**
   * After writing a file, run a compile/syntax check.
   * If errors are found, ask the LLM to fix them — up to MAX_FIX_ATTEMPTS times.
   */
  private async compileCheckLoop(
    threadId: string,
    filePath: string,
    currentContent: string,
    fullPath: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();

    // Only check file types we know how to validate
    if (!['.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
      return;
    }

    const maxFixAttempts = vscode.workspace.getConfiguration('comply').get<number>('llm.maxFixAttempts') ?? 3;
    let prevErrors: string | null = null;
    const signal = this.abortControllers.get(threadId)?.signal;

    for (let attempt = 1; attempt <= maxFixAttempts; attempt++) {
      if (signal?.aborted) throw { name: 'AbortError' };
      let errors = await this.runCompileCheck(fullPath, ext, signal);

      if (signal?.aborted) throw { name: 'AbortError' };
      if (!errors) {
        // No errors — we're good
        if (attempt > 1) {
          callbacks.onToolExec(`✅ Compile errors fixed (attempt ${attempt - 1})`);
        }
        return;
      }

      if (errors === prevErrors) {
        callbacks.onError(`Compile error unchanged after fix attempt ${attempt - 1}. Aborting loop.`);
        break; // Break early if the error hasn't changed at all
      }
      prevErrors = errors;

      // Detect and auto-install missing packages suggested by the compiler
      const npmMatch = errors.match(/Try\s+`(npm\s+i(?:nstall)?\s+[^`]+)`/);
      if (npmMatch) {
        const installCommand = npmMatch[1];
        callbacks.onToolExec(`🔧 Missing types detected — running: ${installCommand}`);
        await this.executeToolCall(threadId, { tool: 'run_terminal_command', command: installCommand }, callbacks);
        
        // Re-check after installing
        errors = await this.runCompileCheck(fullPath, ext, signal);
        if (!errors) {
          callbacks.onToolExec(`✅ Compile errors fixed by installing types.`);
          return;
        }
        prevErrors = errors;
      }

      // Show the errors to the user
      callbacks.onToolExec(
        `🔧 Compile errors in ${filePath} — auto-fixing (attempt ${attempt}/${maxFixAttempts})…`
      );

      // Ask the LLM to fix the errors
      const fixedContent = await this.requestFix(threadId, filePath, currentContent, errors, callbacks);

      if (!fixedContent) {
        callbacks.onError(
          `Could not auto-fix compile errors after ${attempt} attempt(s). Errors:\n${errors}`
        );
        return;
      }

      // Re-evaluate the fixed code for policy compliance
      const violations = this.evaluator.evaluateCode(fixedContent, filePath);
      const policyErrors = violations.filter(v => v.severity === 'error');
      if (policyErrors.length > 0) {
        callbacks.onBlocked(Evaluator.formatViolations(policyErrors));
        callbacks.onError('Auto-fix introduced a policy violation — stopping.');
        return;
      }
      const warnings = violations.filter(v => v.severity === 'warning');
      if (warnings.length > 0) {
        callbacks.onToolExec(Evaluator.formatViolations(warnings));
      }

      // Write the fixed version
      const wrote = await this.writeFile(threadId, filePath, fixedContent, callbacks);
      if (!wrote) {return;}

      currentContent = fixedContent;
      // Loop continues to re-check the fixed version
    }

    // If we exhausted all attempts, check one final time
    const finalErrors = await this.runCompileCheck(fullPath, path.extname(filePath).toLowerCase(), signal);
    if (finalErrors) {
      callbacks.onError(
        `Still has compile errors after ${maxFixAttempts} fix attempts:\n${finalErrors}`
      );
    }
  }

  /**
   * Run a compile/syntax check. Returns error output or null if clean.
   * For TS files, runs tsc --noEmit from the workspace root (respects tsconfig).
   */
  private runCompileCheck(
    fullPath: string, 
    ext: string, 
    signal?: AbortSignal
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      let cmd: string;
      let cwd: string;

      if (ext === '.ts' || ext === '.tsx') {
        // TypeScript — check this individual file relative to workspace root
        cwd = workspaceRoot || path.dirname(fullPath);
        cmd = `npx tsc --noEmit "${fullPath}" 2>&1`;
      } else {
        // JavaScript — Node syntax check on just the file
        cwd = path.dirname(fullPath);
        cmd = `node --check "${fullPath}" 2>&1`;
      }

      const child = exec(cmd, { cwd, timeout: 20000 }, (error, stdout, stderr) => {
        if (signal?.aborted) return; // Promise already rejected below
        
        const output = (stdout || '') + (stderr || '');
        if (error) {
          const trimmed = output.trim().slice(0, 2000);
          resolve(trimmed || 'Unknown compile error');
        } else {
          resolve(null); // Clean
        }
      });

      if (signal) {
        const onAbort = () => {
          child.kill();
          reject({ name: 'AbortError' });
        };
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort);
        }
      }
    });
  }

  /**
   * Ask the LLM to fix compile errors. Returns the fixed file content, or null on failure.
   * This is a non-streaming call to keep it fast.
   */
  private async requestFix(
    threadId: string,
    filePath: string,
    currentContent: string,
    errors: string,
    callbacks: StreamCallbacks
  ): Promise<string | null> {
    const signal = this.abortControllers.get(threadId)?.signal;
    const fixPrompt = [
      `The file "${filePath}" has compile errors. Fix them and return ONLY the complete corrected file content.`,
      `Do NOT wrap it in a markdown code block. Do NOT include any explanation — just the raw file content.`,
      ``,
      `Current file content:`,
      '```',
      currentContent,
      '```',
      ``,
      `Compile errors:`,
      '```',
      errors,
      '```',
    ].join('\n');

    try {
      if (signal?.aborted) throw { name: 'AbortError' };
      if (!this.llm) {
        callbacks.onError('Comply is not configured. Run "Comply: Set API Key" to start.');
        return null;
      }
      // Bug 1 fix: do NOT spread conversationHistory here.
      // conversationHistory contains the full getSrcFilesContent dump
      // (all pre-existing src files). Passing that to the LLM risks it
      // echoing those files back, causing fixedContent to contain
      // pre-existing code and the evaluator to scan wrong files.
      // Send only the targeted fix prompt so fixedContent is exclusively
      // the newly written file's content.
      let fixed = '';
      fixed = await this.llm.chatStream(
        {
          model: this.model,
          messages: [{ role: 'user', content: fixPrompt }],
          temperature: 0.3,
          maxTokens: 4096,
        },
        {
          onToken: () => {
            /* non-streaming not required; provider may still stream */
          },
        },
        signal
      );
      fixed = fixed.trim();
      if (!fixed) {return null;}

      // Strip markdown code fences if the model added them anyway
      let stripped = fixed
        .replace(/^```[\w]*\n?/, '')
        .replace(/\n?```$/, '')
        .trim();

      // If the LLM still output a tool block instead of raw content, extract the content
      try {
        const parsed = JSON.parse(stripped);
        if (parsed.tool === 'write_file' && typeof parsed.content === 'string') {
          stripped = parsed.content.trim();
        }
      } catch {
        // Not a JSON block, use as is (meaning the model successfully followed raw code instruction)
      }

      // Add context to conversation history
      this.getThreadHistory(threadId).push({
        role: 'assistant',
        content: `[AUTO-FIX] Fixed compile errors in "${filePath}".`,
      });

      return stripped;
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) {
        throw err; // Bubble up for actual cancellation handler
      }
      callbacks.onError(`Auto-fix LLM call failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Reset the active thread's conversation history (keeps system prompt).
   */
  public resetConversation(threadId?: string): void {
    const target = threadId ?? this.activeThreadId;
    this.createThread(target);
  }
}
