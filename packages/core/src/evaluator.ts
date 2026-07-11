import * as path from 'path';
import { ResolvedPolicy, PolicySeverity } from './types/policy';

export interface EvalResult {
  passed: boolean;
  severity: PolicySeverity;
  policyId: string;
  policyName: string;
  policyText: string;
  setBy: string;
  description: string;
  suggestion: string;
  line?: number;
}

// Approved packages from the CTO policy
const APPROVED_PACKAGES = new Set([
  'lodash',
  'axios',
  'zod',
  'express',
  'pg',
  'prisma',
  '@prisma/client',
]);

// Also allow dev-only tooling that doesn't ship to production
const DEV_SAFE_PACKAGES = new Set([
  'typescript',
  'eslint',
  'prettier',
  'jest',
  '@types/jest',
  '@jest/globals',
  '@types/node',
  '@types/vscode',
  'ts-node',
  'nodemon',
  'dotenv',
  'groq-sdk',
]);

/**
 * Fast deterministic evaluator — runs regex and string-match checks
 * on proposed code or terminal commands before they execute.
 */
export class Evaluator {
  constructor(private policies: ResolvedPolicy[]) {}

  /**
   * Strip any multi-file dump content that may have leaked in from getSrcFilesContent.
   */
  private extractNewFileContent(code: string, filePath: string): string {
    const dumpHeaderPattern = /^---\s+\S+.*---\s*$/m;
    if (!dumpHeaderPattern.test(code)) {
      return code;
    }

    const basename = filePath.split('/').pop() ?? filePath;
    const escapedBasename = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const blockRegex = new RegExp(
      `---\\s+[^\\n]*${escapedBasename}[^\\n]*---\\s*\\n([\\s\\S]*?)(?=\\n---\\s+|$)`
    );
    const match = code.match(blockRegex);
    return match ? match[1].trim() : code;
  }

  /**
   * Evaluate proposed file content for policy violations.
   */
  public evaluateCode(code: string, filePath: string): EvalResult[] {
    const violations: EvalResult[] = [];

    const newContent = this.extractNewFileContent(code, filePath);

    // 1. Path traversal check (hardcoded system rule)
    if (filePath.includes('..') || path.isAbsolute(filePath)) {
      violations.push({
        passed: false,
        severity: 'error',
        policyId: 'path-traversal',
        policyName: 'Path Traversal Blocked',
        policyText: 'Relative paths must remain within the workspace boundary.',
        setBy: 'System',
        description: 'Blocked: path traversal detected',
        suggestion: 'Use a relative path that stays within the workspace folders.',
      });
    }

    // 2. Policy-driven regex checks
    for (const policy of this.policies) {
      if (policy.evaluator.type !== 'regex' || !policy.evaluator.pattern) {
        continue;
      }

      // Logger file exemption
      if (policy.id === 'no-console-log' && filePath.toLowerCase().includes('logger')) {
        continue;
      }

      const regex = new RegExp(policy.evaluator.pattern, policy.evaluator.flags || '');
      const match = regex.exec(newContent);
      if (match) {
        violations.push({
          passed: false,
          severity: policy.severity,
          policyId: policy.id,
          policyName: policy.id,
          policyText: policy.rule,
          setBy: policy.setByDisplayName,
          description: `Policy violation detected in "${filePath}" for rule: ${policy.rule}`,
          suggestion: policy.fix_suggestion,
          line: newContent.slice(0, match.index).split('\n').length,
        });
      }
    }

    return violations;
  }

  /**
   * Evaluate a proposed terminal command for policy violations.
   */
  public evaluateCommand(command: string): EvalResult[] {
    const violations: EvalResult[] = [];

    for (const policy of this.policies) {
      if (policy.evaluator.type !== 'command' || !policy.evaluator.pattern) {
        continue;
      }

      const regex = new RegExp(policy.evaluator.pattern, policy.evaluator.flags || 'i');
      const match = command.match(regex);

      if (match) {
        // TODO: approved-packages-only uses hardcoded allowlist logic
        // Future: move APPROVED_PACKAGES and DEV_SAFE_PACKAGES into the policy schema
        // as a new evaluator type: "allowlist" with a packages[] field
        if (policy.id === 'approved-packages-only') {
          // Special case: package allowlist logic
          const args = match[0].trim().split(/\s+/).slice(1); // skip 'npm install', etc
          // We need all arguments from the command after the install/add keyword
          // A simple regex match doesn't capture all trailing packages, so we re-parse the full command
          
          let packages: string[] = [];
          if (/npm\s+(?:install|i|add)\s+/i.test(command)) {
            const m = command.match(/npm\s+(?:install|i|add)\s+(.+)/i);
            if (m) packages = m[1].trim().split(/\s+/);
          } else if (/(?:yarn|pnpm)\s+add\s+/i.test(command)) {
            const m = command.match(/(?:yarn|pnpm)\s+add\s+(.+)/i);
            if (m) packages = m[1].trim().split(/\s+/);
          }

          packages = packages.filter((a) => !a.startsWith('-') && !a.startsWith('--'));

          for (const pkg of packages) {
            const pkgName = this.normalizePackageName(pkg);
            if (
              !pkgName.startsWith('@types/') &&
              !APPROVED_PACKAGES.has(pkgName) &&
              !DEV_SAFE_PACKAGES.has(pkgName)
            ) {
              violations.push({
                passed: false,
                severity: policy.severity,
                policyId: policy.id,
                policyName: 'Unapproved Package',
                policyText: policy.rule,
                setBy: policy.setByDisplayName,
                description: `Package "${pkgName}" is not in the approved list.`,
                suggestion: policy.fix_suggestion,
              });
            }
          }
        } else {
          // Standard command regex match
          violations.push({
            passed: false,
            severity: policy.severity,
            policyId: policy.id,
            policyName: policy.id,
            policyText: policy.rule,
            setBy: policy.setByDisplayName,
            description: `Blocked command match for rule: ${policy.rule}`,
            suggestion: policy.fix_suggestion,
          });
        }
      }
    }

    return violations;
  }

  /**
   * Format multiple violations into a single, clean message.
   */
  public static formatViolations(results: EvalResult[]): string {
    const lines: string[] = [];
    
    // Check if there are any errors
    const hasErrors = results.some(r => r.severity === 'error');
    if (hasErrors) {
      lines.push('⛔ Action blocked\n');
    }

    for (const r of results) {
      if (r.severity === 'error') {
        lines.push(`• ${r.description}`);
        lines.push(`  Rule: ${r.policyText}`);
        lines.push(`  Fix: ${r.suggestion}`);
        lines.push(`  Policy by ${r.setBy}\n`);
      } else {
        lines.push(`⚠ Warning — ${r.policyName}`);
        lines.push(`  ${r.suggestion}\n`);
      }
    }

    return lines.join('\n').trim();
  }

  /**
   * Format a single violation (legacy compat).
   */
  public static formatViolation(result: EvalResult, _userRequest: string): string {
    return Evaluator.formatViolations([result]);
  }

  private findPolicy(keyword: string): ResolvedPolicy | undefined {
    const lower = keyword.toLowerCase();
    return this.policies.find((p) => p.rule.toLowerCase().includes(lower));
  }

  private normalizePackageName(pkg: string): string {
    const lastAtIndex = pkg.lastIndexOf('@');
    return lastAtIndex > 0 ? pkg.slice(0, lastAtIndex) : pkg;
  }
}
