import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';

import * as crypto from 'crypto';
import { PolicyRole, PolicyConfig, ResolvedPolicy, Policy } from './types/policy';
import { OrgAIClient, OrgInfo, ResolvedPoliciesResponse } from './orgai-client';

export { PolicyRole as PolicyEntry, PolicyConfig, ResolvedPolicy };
/**
 * Loads and resolves policies from the config file.
 * Walks the inheritance chain to build the full set of policies
 * for the current user's role.
 */
export class PolicyEngine {
  private config: PolicyConfig | null = null;
  private resolvedPolicies: ResolvedPolicy[] = [];
  private systemPrompt: string = '';
  private cachedRemoteConfig: PolicyConfig | null = null;
  private orgClient: OrgAIClient | null = null;
  private orgInfo: OrgInfo | null = null;

  constructor(
    private extensionPath: string,
    private output?: vscode.OutputChannel,
    private secrets?: { get(key: string): Promise<string | undefined> }
  ) {}

  /**
   * Load policies.json from the configured source.
   * Automatic Fallback: OrgAI API -> Remote URL -> Workspace (.comply/policies.json) -> Bundled Extension
   */
  public async load(): Promise<void> {
    const config = vscode.workspace.getConfiguration('comply');
    
    // 0. Try OrgAI API if configured
    const apiKey = await this.secrets?.get('comply.org.apiKey');
    const apiUrl = config.get<string>('org.apiUrl') || 'https://api.orgai.dev';
    
    if (apiKey && apiKey.trim().length > 0) {
      try {
        if (!this.orgClient) {
          this.orgClient = new OrgAIClient(apiKey.trim(), apiUrl);
        }
        
        this.orgInfo = await this.orgClient.getOrgInfo();
        const roleName = config.get<string>('currentUserRole') || 'junior';
        
        const response = await this.orgClient.resolveRole(this.orgInfo.orgId, roleName);
        
        this.resolvedPolicies = response.policies.map((apiPolicy: any) => ({
          id: apiPolicy.id,
          rule: apiPolicy.rule,
          skill: apiPolicy.skill ?? '',
          evaluator: {
            type: apiPolicy.evaluatorType ?? 'none',
            pattern: apiPolicy.evaluatorPattern,
            flags: apiPolicy.evaluatorFlags,
          },
          fix_suggestion: apiPolicy.fixSuggestion ?? '',
          severity: (apiPolicy.severity ?? 'error').toLowerCase(),
          setByRole: apiPolicy.setByRole,
          setByDisplayName: apiPolicy.setByDisplayName,
        }));
        
        // Mock a config object for getCurrentRoleDisplay to use
        this.config = {
          hierarchy: [{ role: roleName, displayName: response.role.displayName, policies: [] }],
          currentUserRole: roleName
        };
        
        this.buildSystemPromptAPI(response.resolvedFrom, response.policies, response.role.displayName);
        this.output?.appendLine(`[Comply] Policies loaded from OrgAI platform: ${this.orgInfo.orgName} (${response.role.displayName})`);
        return;
      } catch (e: any) {
        this.output?.appendLine(`[Comply] OrgAI API unavailable (${e.message}), falling back to next source`);
      }
    }

    const remoteUrl = config.get<string>('policies.url');

    // 1. Try Remote URL if configured
    if (remoteUrl && remoteUrl.trim().length > 0) {
      if (this.cachedRemoteConfig) {
        this.output?.appendLine('[Comply] Policies loaded from cache');
        this.config = this.cachedRemoteConfig;
        this.resolve();
        return;
      }

      try {
        const authHeader = await this.secrets?.get('comply.policyAuthHeader');
        const fetched = await this.fetchRemote(remoteUrl.trim(), authHeader);
        if (fetched) {
          this.output?.appendLine(`[Comply] Policies loaded from remote: ${remoteUrl}`);
          this.cachedRemoteConfig = fetched;
          this.config = fetched;
          this.resolve();
          return;
        }
      } catch (e: any) {
        const statusMsg = e.message?.includes('Status:') ? ` (returned ${e.message.split('Status: ')[1]})` : '';
        this.output?.appendLine(`[Comply] Remote policy fetch failed${statusMsg}, using local fallback`);
        vscode.window.showWarningMessage(
          `Comply: Could not load remote policies${statusMsg}, using local fallback.`
        );
      }
    }

    // 2. Try Workspace Fallback
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsRoot) {
      const wsConfigPath = path.join(wsRoot, '.comply', 'policies.json');
      const wsConfigUri = vscode.Uri.file(wsConfigPath);
      try {
        const stats = await vscode.workspace.fs.stat(wsConfigUri);
        if (stats.type === vscode.FileType.File) {
          const raw = await vscode.workspace.fs.readFile(wsConfigUri);
          const parsed = JSON.parse(Buffer.from(raw).toString('utf-8')) as PolicyConfig;
          if (this.validateSchema(parsed)) {
            this.config = parsed;
            this.output?.appendLine(`[Comply] Policies loaded from workspace: ${wsConfigPath}`);
            this.resolve();
            return;
          }
        }
      } catch (e) {
        // Workspace file missing or invalid, fall through
      }
    }

    // 3. Try Bundled Extension Fallback
    const localPath = path.join(this.extensionPath, 'config', 'policies.json');
    const localUri = vscode.Uri.file(localPath);
    try {
      const raw = await vscode.workspace.fs.readFile(localUri);
      const parsed = JSON.parse(Buffer.from(raw).toString('utf-8')) as PolicyConfig;
      if (this.validateSchema(parsed)) {
        this.config = parsed;
        this.output?.appendLine(`[Comply] Policies loaded from bundled config: ${localPath}`);
        this.resolve();
        return;
      } else {
        throw new Error('Invalid schema in bundled config');
      }
    } catch (e) {
      this.output?.appendLine('[Comply] Failed to load any policies.');
      vscode.window.showErrorMessage('Comply: Failed to load any policies. Check your policy configuration.');
      this.config = null;
      this.resolvedPolicies = [];
      this.systemPrompt = '';
    }
  }

  private validateSchema(config: any): config is PolicyConfig {
    if (!config || typeof config !== 'object') return false;
    if (!Array.isArray(config.hierarchy)) return false;
    if (typeof config.currentUserRole !== 'string') return false;
    for (const entry of config.hierarchy) {
      if (!entry.role || !entry.displayName || !Array.isArray(entry.policies)) return false;
      for (const p of entry.policies) {
        if (typeof p === 'string') {
          if (p.trim().length === 0) return false;
        } else if (typeof p === 'object' && p !== null) {
          if (typeof p.id !== 'string' || typeof p.rule !== 'string' || typeof p.skill !== 'string' || typeof p.fix_suggestion !== 'string' || typeof p.severity !== 'string') return false;
          if (!p.evaluator || typeof p.evaluator.type !== 'string') return false;
        } else {
          return false;
        }
      }
    }
    return true;
  }

  public clearCache(): void {
    this.cachedRemoteConfig = null;
    this.orgInfo = null;
    if (this.orgClient) {
      this.orgClient.clearCache();
    }
  }

  public refreshOrgClient(): void {
    this.orgClient = null;
    this.orgInfo = null;
  }

  public getOrgClient(): OrgAIClient | null {
    return this.orgClient;
  }

  public getOrgId(): string | null {
    return this.orgInfo?.orgId || null;
  }

  public getCurrentRole(): string {
    return this.config?.currentUserRole || 'junior';
  }

  private fetchRemote(url: string, authHeader?: string): Promise<PolicyConfig | null> {
    return new Promise((resolve, reject) => {
      const opts: https.RequestOptions = { headers: {} };
      if (authHeader) {
        (opts.headers as any)['Authorization'] = authHeader;
      }
      https
        .get(url, opts, (res: any) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Status: ${res.statusCode}`));
            return;
          }
          let body = '';
          res.on('data', (chunk: any) => (body += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body) as PolicyConfig);
            } catch (e) {
              reject(e);
            }
          });
        })
        .on('error', reject);
    });
  }

  /**
   * Walk the inheritsFrom chain and collect all policies
   * from root down to the current user's role.
   */
  private resolve(): void {
    if (!this.config) {return;}

    const roleMap = new Map<string, PolicyRole>();
    for (const entry of this.config.hierarchy) {
      roleMap.set(entry.role, entry);
    }

    // Build chain from current role up to root
    const chain: PolicyRole[] = [];
    let current = roleMap.get(this.config.currentUserRole);
    const visited = new Set<string>();

    while (current && !visited.has(current.role)) {
      visited.add(current.role);
      chain.unshift(current); // prepend so root is first
      if (current.inheritsFrom) {
        current = roleMap.get(current.inheritsFrom);
      } else {
        break;
      }
    }

    // Flatten policies with attribution
    this.resolvedPolicies = [];
    for (const entry of chain) {
      for (const policyData of entry.policies) {
        if (typeof policyData === 'string') {
          this.resolvedPolicies.push({
            id: crypto.randomUUID(),
            rule: policyData,
            skill: '',
            evaluator: { type: 'none' },
            fix_suggestion: '',
            severity: 'error',
            setByRole: entry.role,
            setByDisplayName: entry.displayName,
          });
        } else {
          this.resolvedPolicies.push({
            ...(policyData as Policy),
            setByRole: entry.role,
            setByDisplayName: entry.displayName,
          });
        }
      }
    }

    // Build the system prompt block
    this.buildSystemPrompt(chain);
  }

  private buildSystemPrompt(chain: PolicyRole[]): void {
    const lines: string[] = [
      'You are a coding agent embedded in VS Code. You have access to the user workspace.',
      'Your job is to write and modify code files directly in the workspace.',
      'You will be given the workspace file tree so you know what already exists.',
      '',
    ];

    for (const entry of chain) {
      if (entry.policies.length === 0) {continue;}
      lines.push(`[FROM ${entry.displayName}]`);
      for (const p of this.resolvedPolicies.filter(rp => rp.setByRole === entry.role)) {
        if (p.skill) {
          lines.push(`Rule: ${p.rule}`);
          lines.push(`How to comply: ${p.skill}`);
        } else {
          lines.push(`- ${p.rule}`);
        }
      }
      lines.push('');
    }

    lines.push(
      'Before writing code or executing tools, you MUST evaluate the request against your compliance policies.',
      'Wrap your compliance reasoning inside <thinking> ... </thinking> tags.',
      'Be brief in your thinking block. After the `<thinking>` block, proceed with tool blocks to fulfill the request.',
      '',
      'IMPORTANT: Always use real, specific file paths relative to the workspace root.',
      'Never use placeholder paths like "path/to/file.ts" or "your-file.ts".',
      'Look at the workspace file tree provided and use paths that make sense for the project.',
      '',
      'To write a file, output this exact JSON format in a fenced block:',
      '```json',
      '{"tool":"write_file","path":"src/server.ts","content":"// actual file content"}',
      '```',
      '',
      'To run a terminal command, output this exact JSON format in a fenced block:',
      '```json',
      '{"tool":"run_terminal_command","command":"npm install express"}',
      '```',
      '',
      'You may output multiple tool blocks in one response. Briefly explain what you are doing before each one.',
    );

    this.systemPrompt = lines.join('\n');
  }

  private buildSystemPromptAPI(resolvedFrom: string[], apiPolicies: any[], currentRoleDisplay: string): void {
    const lines: string[] = [
      'You are a coding agent embedded in VS Code. You have access to the user workspace.',
      'Your job is to write and modify code files directly in the workspace.',
      'You will be given the workspace file tree so you know what already exists.',
      '',
    ];

    // Group policies by role for the prompt
    for (const roleName of resolvedFrom) {
      const rolePolicies = this.resolvedPolicies.filter(rp => rp.setByRole === roleName);
      if (rolePolicies.length === 0) continue;
      
      const displayName = rolePolicies[0].setByDisplayName || roleName;
      lines.push(`[FROM ${displayName}]`);
      
      for (const p of rolePolicies) {
        if (p.skill) {
          lines.push(`Rule: ${p.rule}`);
          lines.push(`How to comply: ${p.skill}`);
        } else {
          lines.push(`- ${p.rule}`);
        }
      }
      lines.push('');
    }

    lines.push(
      'Before writing code or executing tools, you MUST evaluate the request against your compliance policies.',
      'Wrap your compliance reasoning inside <thinking> ... </thinking> tags.',
      'Be brief in your thinking block. After the `<thinking>` block, proceed with tool blocks to fulfill the request.',
      '',
      'IMPORTANT: Always use real, specific file paths relative to the workspace root.',
      'Never use placeholder paths like "path/to/file.ts" or "your-file.ts".',
      'Look at the workspace file tree provided and use paths that make sense for the project.',
      '',
      'To write a file, output this exact JSON format in a fenced block:',
      '```json',
      '{"tool":"write_file","path":"src/server.ts","content":"// actual file content"}',
      '```',
      '',
      'To run a terminal command, output this exact JSON format in a fenced block:',
      '```json',
      '{"tool":"run_terminal_command","command":"npm install express"}',
      '```',
      '',
      'You may output multiple tool blocks in one response. Briefly explain what you are doing before each one.',
    );

    this.systemPrompt = lines.join('\n');
  }

  /**
   * Get the assembled system prompt with all policies injected.
   */
  public getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /**
   * Get the flat list of resolved policies with attribution.
   */
  public getResolvedPolicies(): ResolvedPolicy[] {
    return this.resolvedPolicies;
  }

  /**
   * Get current user role display name.
   */
  public getCurrentRoleDisplay(): string {
    if (!this.config) {return 'Unknown';}
    const entry = this.config.hierarchy.find(
      (e) => e.role === this.config!.currentUserRole
    );
    return entry?.displayName ?? this.config.currentUserRole;
  }

  /**
   * Find which policy matches a given text (for evaluator attribution).
   */
  public findMatchingPolicy(keyword: string): ResolvedPolicy | undefined {
    const lower = keyword.toLowerCase();
    return this.resolvedPolicies.find((p) =>
      p.rule.toLowerCase().includes(lower)
    );
  }

  /**
   * Get all defined roles for the setup panel.
   */
  public getAllRoles(): { role: string; displayName: string }[] {
    if (!this.config) {return [];}
    return this.config.hierarchy.map((e) => ({
      role: e.role,
      displayName: e.displayName,
    }));
  }

  /**
   * Save the current user role to policies.json.
   * Detecting path automatically: workspace if exists, otherwise extension.
   */
  public async saveRole(newRole: string): Promise<void> {
    if (!this.config) {return;}
    this.config.currentUserRole = newRole;

    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const wsConfigPath = wsRoot ? path.join(wsRoot, '.comply', 'policies.json') : '';
    const bundledPath = path.join(this.extensionPath, 'config', 'policies.json');

    let targetPath = bundledPath;
    if (wsConfigPath && fs.existsSync(wsConfigPath)) {
      targetPath = wsConfigPath;
    }

    try {
      const fullUri = vscode.Uri.file(targetPath);
      const raw = await vscode.workspace.fs.readFile(fullUri);
      const parsed = JSON.parse(Buffer.from(raw).toString('utf-8'));
      parsed.currentUserRole = newRole;
      await vscode.workspace.fs.writeFile(
        fullUri,
        Buffer.from(JSON.stringify(parsed, null, 2), 'utf-8')
      );
      this.output?.appendLine(`[Comply] Saved role "${newRole}" to ${targetPath}`);
    } catch (e) {
      console.error('Failed to save policies.json', e);
    }
    
    this.resolve();
  }
}
