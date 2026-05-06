import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { PolicyRole, PolicyConfig, ResolvedPolicy, Policy } from './types/policy';

export { PolicyRole as PolicyEntry, PolicyConfig, ResolvedPolicy };

export class PolicyEngine {
  private config: PolicyConfig | null = null;
  private resolvedPolicies: ResolvedPolicy[] = [];
  private systemPrompt: string = '';
  private cachedRemoteConfig: PolicyConfig | null = null;
  private opts: {
    policyUrl?: string;
    authHeader?: string;
    bundledPolicyPath?: string;
    workspaceRoot?: string;
    logger?: (msg: string) => void;
  };

  constructor(opts: {
    policyUrl?: string;
    authHeader?: string;
    bundledPolicyPath?: string;
    workspaceRoot?: string;
    logger?: (msg: string) => void;
  }) {
    this.opts = opts;
  }

  public async load(): Promise<void> {
    const { policyUrl, authHeader, workspaceRoot, bundledPolicyPath, logger } = this.opts;

    // 1. Try Remote URL if configured
    if (policyUrl && policyUrl.trim().length > 0) {
      if (this.cachedRemoteConfig) {
        logger?.('[Comply] Policies loaded from cache');
        this.config = this.cachedRemoteConfig;
        return;
      }

      try {
        const fetched = await this.fetchRemote(policyUrl.trim(), authHeader);
        if (fetched) {
          logger?.(`[Comply] Policies loaded from remote: ${policyUrl}`);
          this.cachedRemoteConfig = fetched;
          this.config = fetched;
          return;
        }
      } catch (e: any) {
        logger?.(`[Comply] Remote policy fetch failed: ${e.message}, using local fallback`);
      }
    }

    // 2. Try Workspace Fallback
    const wsRoot = workspaceRoot ?? process.cwd();
    const wsConfigPath = path.join(wsRoot, '.comply', 'policies.json');
    try {
      if (fs.existsSync(wsConfigPath)) {
        const raw = fs.readFileSync(wsConfigPath, 'utf-8');
        const parsed = JSON.parse(raw) as PolicyConfig;
        if (this.validateSchema(parsed)) {
          this.config = parsed;
          logger?.(`[Comply] Policies loaded from workspace: ${wsConfigPath}`);
          return;
        }
      }
    } catch (e) {
      // Workspace file missing or invalid, fall through
    }

    // 3. Try Bundled Extension Fallback
    if (bundledPolicyPath) {
      try {
        const raw = fs.readFileSync(bundledPolicyPath, 'utf-8');
        const parsed = JSON.parse(raw) as PolicyConfig;
        if (this.validateSchema(parsed)) {
          this.config = parsed;
          logger?.(`[Comply] Policies loaded from bundled config: ${bundledPolicyPath}`);
          return;
        } else {
          throw new Error('Invalid schema in bundled config');
        }
      } catch (e) {
        // Fall through
      }
    }

    logger?.('[Comply] Failed to load any policies.');
    this.config = null;
    this.resolvedPolicies = [];
    this.systemPrompt = '';
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
  }

  private async fetchRemote(url: string, authHeader?: string): Promise<PolicyConfig | null> {
    const headers: Record<string, string> = {};
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Status: ${response.status}`);
    }
    return (await response.json()) as PolicyConfig;
  }

  /**
   * Walk the inheritsFrom chain and collect all policies
   * from root down to the specified role.
   */
  public resolve(role: string): void {
    if (!this.config) {return;}

    // Update current role
    this.config.currentUserRole = role;

    const roleMap = new Map<string, PolicyRole>();
    for (const entry of this.config.hierarchy) {
      roleMap.set(entry.role, entry);
    }

    // Build chain from current role up to root
    const chain: PolicyRole[] = [];
    let current = roleMap.get(role);
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
}
