import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as path from "path";
import { PolicyEngine, Evaluator } from "@comply/core";
import { OrgAIClient } from "./api-client";

// Directs the calling agent to pause and involve the human before continuing.
function guidance(blockerCount: number, warningCount: number, autoFix: boolean): string | undefined {
  if (blockerCount > 0) {
    return autoFix
      ? "BLOCKED: do not apply this change as-is. First revise the code yourself using each violation's fix suggestion, then re-run this check. If it still fails after one revision, stop, show the violations to the user, and ask how they want to proceed."
      : "BLOCKED: do not apply this change. Autofix is disabled — do not revise the code yourself. Show the violations to the user and ask how they want to proceed.";
  }
  if (warningCount > 0) {
    return "WARNINGS: before proceeding, show these warnings to the user and ask whether to proceed as-is or modify their request. Wait for their answer.";
  }
  return undefined;
}

// Fail closed: a compliance check with no policies loaded must not pass.
function noPoliciesError() {
  return {
    content: [{
      type: "text" as const,
      text: "No compliance policies could be loaded (policy URL, workspace config and bundled policies all unavailable). Failing closed: do not proceed — report this configuration problem to the user."
    }],
    isError: true
  };
}

// Fail closed on any error (API unreachable, unknown role, timeout): the agent
// must NOT treat a failed check as a pass.
function failClosedError(err: any) {
  return {
    content: [{
      type: "text" as const,
      text: `Compliance check could not complete (${err?.message || err}). Failing closed: do not proceed with this change — report this problem to the user.`
    }],
    isError: true
  };
}

const isBlocker = (v: any) => v.severity === 'error' || v.severity === 'ERROR';
const isWarning = (v: any) => v.severity === 'warning' || v.severity === 'WARNING';

// Build a check_compliance/check_command response. Emits violations ONCE plus
// blockerCount/warningCount rather than re-serializing blocker/warning subsets
// (that tripled the token cost). `passed` defaults to "no blockers".
function checkResult(violations: any[], autoFix: boolean, passedOverride?: boolean) {
  const blockerCount = violations.filter(isBlocker).length;
  const warningCount = violations.filter(isWarning).length;
  const passed = passedOverride ?? blockerCount === 0;
  const summary = violations.length > 0
    ? `${blockerCount} errors, ${warningCount} warning found`
    : "All checks passed";
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ passed, violations, blockerCount, warningCount, summary, guidance: guidance(blockerCount, warningCount, autoFix) }, null, 2)
    }]
  };
}

function resolveParams(input: { policyUrl?: string; userRole?: string; authHeader?: string }) {
  return {
    policyUrl: input.policyUrl || process.env.COMPLY_POLICY_URL || undefined,
    userRole: input.userRole || process.env.COMPLY_USER_ROLE || 'junior',
    authHeader: input.authHeader || process.env.COMPLY_AUTH_HEADER,
    bundledPolicyPath: path.resolve(__dirname, 'policies.json'),
  };
}

export function registerTools(server: McpServer) {
  const isApiMode = !!process.env.COMPLY_API_KEY;
  const client = isApiMode ? new OrgAIClient() : null;

  // Autofix precedence: session toggle (set_autofix) > org dashboard setting
  // (API mode) > COMPLY_AUTOFIX env > on.
  const envAutoFix = process.env.COMPLY_AUTOFIX !== 'false';
  let sessionAutoFix: boolean | null = null;
  const effectiveAutoFix = (orgAutoFix?: boolean) => sessionAutoFix ?? orgAutoFix ?? envAutoFix;

  server.tool(
    "set_autofix",
    "Enable or disable autofix for this session. When enabled (default), the agent is told to self-correct blocked code using policy fix suggestions before asking the user. When disabled, every blocked check goes straight to the user.",
    { enabled: z.boolean().describe("true to enable autofix, false to disable") } as any,
    async (params: any) => {
      sessionAutoFix = !!params.enabled;
      return {
        content: [{
          type: "text" as const,
          text: `Autofix is now ${sessionAutoFix ? 'ENABLED: blocked code will be self-corrected using policy fix suggestions before involving the user' : 'DISABLED: every blocked check will be shown to the user before any code is changed'} for this session (overrides the organization default).`
        }]
      };
    }
  );

  // Exposed as slash commands in MCP clients that surface prompts
  // (e.g. /mcp__orgai__autofix-on in Claude Code).
  if (typeof (server as any).prompt === 'function') {
    (server as any).prompt("autofix-on", "Enable OrgAI autofix (agent self-corrects blocked code)", () => ({
      messages: [{ role: "user", content: { type: "text", text: "Call the set_autofix tool with enabled=true, then confirm to me that autofix is on." } }]
    }));
    (server as any).prompt("autofix-off", "Disable OrgAI autofix (always ask before changing blocked code)", () => ({
      messages: [{ role: "user", content: { type: "text", text: "Call the set_autofix tool with enabled=false, then confirm to me that autofix is off." } }]
    }));
    (server as any).prompt("load-policies", "Load org coding policies so code is compliant on the first try", () => ({
      messages: [{ role: "user", content: { type: "text", text: "Call the get_policy tool for my role, read every policy's skill, and follow them all while writing code for the rest of this session. Summarize the rules for me in a few bullets." } }]
    }));
  }

  const checkComplianceSchema = z.object({
    code: z.string().describe("The code to check"),
    filePath: z.string().describe("File path (used for context, e.g. logger exemption)"),
    userRole: z.string().optional().describe("Role key e.g. 'junior', 'senior', 'lead', 'cto'. Comma-separate for multiple roles ('payments-dev,ml-dev') — policies from every role's chain apply"),
    policyUrl: z.string().optional().describe("Remote URL to fetch policies.json from"),
    authHeader: z.string().optional().describe("Optional Authorization header for private policy URLs"),
  });

  server.tool(
    "check_compliance",
    "Check a code snippet or file content against the org's compliance policies for a given user role. Returns violations, their severity, and fix suggestions.",
    checkComplianceSchema.shape as any,
    async (params: any) => {
      const { policyUrl, userRole, authHeader, bundledPolicyPath } = resolveParams(params);
      try {
        if (isApiMode && client) {
          const orgInfo = await client.getOrgFromApiKey();
          const res = await client.check(orgInfo.orgId, {
            type: 'code',
            content: params.code,
            filePath: params.filePath,
            roleName: userRole
          });
          return checkResult(res.violations, effectiveAutoFix(orgInfo.autoFix), res.passed);
        }

        const engine = new PolicyEngine({ policyUrl, authHeader, bundledPolicyPath });
        await engine.load();
        if (!engine.isLoaded()) return noPoliciesError();
        engine.resolve(userRole);

        const evaluator = new Evaluator(engine.getResolvedPolicies());
        const violations = evaluator.evaluateCode(params.code, params.filePath);
        return checkResult(violations, effectiveAutoFix());
      } catch (err: any) {
        return failClosedError(err);
      }
    }
  );

  const checkCommandSchema = z.object({
    command: z.string().describe("Terminal command to check"),
    userRole: z.string().optional().describe("Role key"),
    policyUrl: z.string().optional().describe("Remote URL"),
    authHeader: z.string().optional().describe("Auth header"),
  });

  server.tool(
    "check_command",
    "Check a terminal command (e.g. npm install, git push) against compliance policies before running it.",
    checkCommandSchema.shape as any,
    async (params: any) => {
      const { policyUrl, userRole, authHeader, bundledPolicyPath } = resolveParams(params);
      try {
        if (isApiMode && client) {
          const orgInfo = await client.getOrgFromApiKey();
          const res = await client.check(orgInfo.orgId, {
            type: 'command',
            content: params.command,
            roleName: userRole
          });
          return checkResult(res.violations, effectiveAutoFix(orgInfo.autoFix), res.passed);
        }

        const engine = new PolicyEngine({ policyUrl, authHeader, bundledPolicyPath });
        await engine.load();
        if (!engine.isLoaded()) return noPoliciesError();
        engine.resolve(userRole);

        const evaluator = new Evaluator(engine.getResolvedPolicies());
        const violations = evaluator.evaluateCommand(params.command);
        return checkResult(violations, effectiveAutoFix());
      } catch (err: any) {
        return failClosedError(err);
      }
    }
  );

  const getPolicySchema = z.object({
    userRole: z.string().optional().describe("Role key"),
    policyUrl: z.string().optional().describe("Remote URL"),
    authHeader: z.string().optional().describe("Auth header"),
  });

  server.tool(
    "get_policy",
    "Fetch and return the resolved compliance policy for a given user role. Useful for understanding what rules apply before starting a task.",
    getPolicySchema.shape as any,
    async (params: any) => {
      const { policyUrl, userRole, authHeader, bundledPolicyPath } = resolveParams(params);

      // Return only agent-relevant fields — full policy rows (ids, timestamps,
      // evaluator regexes) waste the calling agent's context tokens.
      const slim = (p: any) => ({
        name: p.name || p.id,
        rule: p.rule,
        skill: p.skill || undefined,
        severity: p.severity,
        fixSuggestion: p.fixSuggestion || p.fix_suggestion || undefined,
        setBy: p.setByDisplayName || undefined,
      });

      try {
        if (isApiMode && client) {
          const orgInfo = await client.getOrgFromApiKey();
          const res = await client.resolveRole(orgInfo.orgId, userRole);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                role: res.role.name,
                displayName: res.role.displayName,
                policies: (res.policies || []).map(slim),
                resolvedFrom: res.resolvedFrom
              }, null, 2)
            }]
          };
        }

        const engine = new PolicyEngine({ policyUrl, authHeader, bundledPolicyPath });
        await engine.load();
        if (!engine.isLoaded()) return noPoliciesError();
        engine.resolve(userRole);

        const role = userRole;
        const displayName = engine.getCurrentRoleDisplay();
        const policies = engine.getResolvedPolicies().map(slim);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ role, displayName, policies }, null, 2)
          }]
        };
      } catch (err: any) {
        return failClosedError(err);
      }
    }
  );

  const scanDiffSchema = z.object({
    diff: z.string().describe("raw output of git diff or git diff --cached"),
    userRole: z.string().optional().describe("Role key"),
    policyUrl: z.string().optional().describe("Remote URL"),
    authHeader: z.string().optional().describe("Auth header"),
  });

  server.tool(
    "scan_diff",
    "Scan a git diff for compliance violations. Parses added lines (+) from the diff and checks them against code and command policies.",
    scanDiffSchema.shape as any,
    async (params: any) => {
      const { policyUrl, userRole, authHeader, bundledPolicyPath } = resolveParams(params);
      try {
      let orgId: string | null = null;
      let orgAutoFix: boolean | undefined;
      let evaluator: Evaluator | null = null;

      if (isApiMode && client) {
        const orgInfo = await client.getOrgFromApiKey();
        orgId = orgInfo.orgId;
        orgAutoFix = orgInfo.autoFix;
      } else {
        const engine = new PolicyEngine({ policyUrl, authHeader, bundledPolicyPath });
        await engine.load();
        if (!engine.isLoaded()) return noPoliciesError();
        engine.resolve(userRole);
        evaluator = new Evaluator(engine.getResolvedPolicies());
      }

      const files: { path: string, violations: any[] }[] = [];
      const commands: { command: string, violations: any[] }[] = [];
      let totalBlockers = 0;
      let totalWarnings = 0;
      
      const lines = params.diff.split('\n');
      let currentFile = '';
      let addedLines: string[] = [];

      const flushFile = async () => {
        if (currentFile && addedLines.length > 0) {
          const code = addedLines.join('\n');
          let violations: any[] = [];
          
          if (isApiMode && client && orgId) {
            const res = await client.check(orgId, { type: 'code', content: code, filePath: currentFile, roleName: userRole });
            violations = res.violations;
          } else if (evaluator) {
            violations = evaluator.evaluateCode(code, currentFile);
          }
          
          if (violations.length > 0) {
            files.push({ path: currentFile, violations });
            totalBlockers += violations.filter((v: any) => v.severity === 'error' || v.severity === 'ERROR').length;
            totalWarnings += violations.filter((v: any) => v.severity === 'warning' || v.severity === 'WARNING').length;
          }
        }
      };

      for (const line of lines) {
        if (line.startsWith('+++ b/')) {
          await flushFile();
          currentFile = line.substring(6);
          addedLines = [];
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          const content = line.substring(1);
          addedLines.push(content);
          
          const cmdMatch = line.match(/^\+\s*(npm\s+(install|i|add)\s|yarn\s+add\s|pnpm\s+add\s|git\s+push\s)/);
          if (cmdMatch) {
            let violations: any[] = [];
            if (isApiMode && client && orgId) {
              const res = await client.check(orgId, { type: 'command', content: content.trim(), roleName: userRole });
              violations = res.violations;
            } else if (evaluator) {
              violations = evaluator.evaluateCommand(content.trim());
            }
            
            if (violations.length > 0) {
              commands.push({ command: content.trim(), violations });
              totalBlockers += violations.filter((v: any) => v.severity === 'error' || v.severity === 'ERROR').length;
              totalWarnings += violations.filter((v: any) => v.severity === 'warning' || v.severity === 'WARNING').length;
            }
          }
        }
      }
      await flushFile();

      const passed = totalBlockers === 0;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ files, commands, totalBlockers, totalWarnings, passed, guidance: guidance(totalBlockers, totalWarnings, effectiveAutoFix(orgAutoFix)) }, null, 2)
        }]
      };
      } catch (err: any) {
        return failClosedError(err);
      }
    }
  );

  server.tool(
    "list_roles",
    "List available user roles in the organization (API mode only)",
    {},
    async () => {
      if (!isApiMode || !client) {
        return {
          content: [{ type: "text" as const, text: "list_roles is only available in API mode (COMPLY_API_KEY must be set)." }],
          isError: true
        };
      }
      
      try {
        const orgInfo = await client.getOrgFromApiKey();
        const res = await client.listRoles(orgInfo.orgId);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(res, null, 2)
          }]
        };
      } catch (err: any) {
        return failClosedError(err);
      }
    }
  );

  const auditQuerySchema = z.object({
    action: z.string().optional().describe("Filter by action (e.g. policy.violated)"),
    limit: z.number().optional().describe("Number of records to return")
  });
  
  server.tool(
    "audit_query",
    "Query recent compliance audit logs (API mode only)",
    auditQuerySchema.shape as any,
    async (params: any) => {
      if (!isApiMode || !client) {
        return {
          content: [{ type: "text" as const, text: "audit_query is only available in API mode (COMPLY_API_KEY must be set)." }],
          isError: true
        };
      }
      
      try {
        const orgInfo = await client.getOrgFromApiKey();
        const res = await client.getAuditLog(orgInfo.orgId, params);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(res, null, 2)
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error querying audit logs: ${err.message}` }],
          isError: true
        };
      }
    }
  );
}
