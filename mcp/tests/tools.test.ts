import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../src/tools";
import { OrgAIClient } from "../src/api-client";
import { PolicyEngine, Evaluator } from "@comply/core";

jest.mock("../src/api-client");
jest.mock("@comply/core");

describe("tools", () => {
  let server: any;
  let mockTools: Record<string, any> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.COMPLY_API_KEY;
    // tools fail closed when isLoaded() is falsy — the auto-mock returns undefined
    (PolicyEngine.prototype.isLoaded as jest.Mock).mockReturnValue(true);

    server = {
      tool: jest.fn((name, desc, shape, handler) => {
        mockTools[name] = handler;
      })
    };
  });

  describe("Standalone mode", () => {
    beforeEach(() => {
      registerTools(server as any);
    });

    it("1. check_compliance passes on clean code", async () => {
      (PolicyEngine.prototype.load as jest.Mock).mockResolvedValue(undefined);
      (PolicyEngine.prototype.getResolvedPolicies as jest.Mock).mockReturnValue([]);
      (Evaluator.prototype.evaluateCode as jest.Mock).mockReturnValue([]);

      const result = await mockTools.check_compliance({ code: "const x = 1", filePath: "index.ts" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.passed).toBe(true);
      expect(parsed.violations).toHaveLength(0);
    });

    it("2. check_compliance returns violation for hardcoded secret", async () => {
      (Evaluator.prototype.evaluateCode as jest.Mock).mockReturnValue([{
        policyName: "no-hardcoded-secrets", severity: "error"
      }]);

      const result = await mockTools.check_compliance({ code: "const secret = '123'" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.passed).toBe(false);
      expect(parsed.blockerCount).toBe(1);
      expect(parsed.guidance).toMatch(/BLOCKED/);
    });

    it("2c. set_autofix(false) switches blocked guidance to ask-the-user", async () => {
      (Evaluator.prototype.evaluateCode as jest.Mock).mockReturnValue([{
        policyName: "no-hardcoded-secrets", severity: "error"
      }]);

      await mockTools.set_autofix({ enabled: false });
      const result = await mockTools.check_compliance({ code: "const secret = '123'" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.guidance).toMatch(/Autofix is disabled/);
    });

    it("2b. check_compliance fails closed when no policies load", async () => {
      (PolicyEngine.prototype.isLoaded as jest.Mock).mockReturnValue(false);

      const result = await mockTools.check_compliance({ code: "const x = 1" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Failing closed/);
    });

    it("3. check_command blocks npm install --save", async () => {
      (Evaluator.prototype.evaluateCommand as jest.Mock).mockReturnValue([{
        policyName: "no-unapproved-deps", severity: "error"
      }]);

      const result = await mockTools.check_command({ command: "npm install --save foo" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.passed).toBe(false);
    });

    it("4. get_policy returns resolved policies for role", async () => {
      (PolicyEngine.prototype.getCurrentRoleDisplay as jest.Mock).mockReturnValue("Junior Dev");
      (PolicyEngine.prototype.getResolvedPolicies as jest.Mock).mockReturnValue([{ id: "p1" }]);
      (PolicyEngine.prototype.getSystemPrompt as jest.Mock).mockReturnValue("prompt");

      const result = await mockTools.get_policy({ userRole: "junior" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.role).toBe("junior");
      expect(parsed.policies).toHaveLength(1);
    });

    it("5. scan_diff detects violation in added lines", async () => {
      (Evaluator.prototype.evaluateCode as jest.Mock).mockReturnValue([{ severity: "error" }]);
      const diff = `+++ b/index.ts\n+const secret = "123"`;
      
      const result = await mockTools.scan_diff({ diff });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.passed).toBe(false);
      expect(parsed.totalBlockers).toBe(1);
    });

    it("6. list_roles is unavailable in standalone mode", async () => {
      const result = await mockTools.list_roles();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("only available in API mode");
    });
  });

  describe("API mode", () => {
    beforeEach(() => {
      process.env.COMPLY_API_KEY = "test_key";
      registerTools(server as any);
    });

    it("7. check_compliance calls client.check() once with correct params", async () => {
      const mockClient = OrgAIClient.prototype;
      (mockClient.getOrgFromApiKey as jest.Mock).mockResolvedValue({ orgId: "org_1", orgName: "Acme Corp" });
      (mockClient.check as jest.Mock).mockResolvedValue({ passed: true, violations: [] });

      const result = await mockTools.check_compliance({ code: "const x = 1", filePath: "index.ts", userRole: "junior" });
      
      expect(mockClient.check).toHaveBeenCalledTimes(1);
      expect(mockClient.check).toHaveBeenCalledWith("org_1", {
        type: "code",
        content: "const x = 1",
        filePath: "index.ts",
        roleName: "junior"
      });
      
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.passed).toBe(true);
    });

    it("8. get_policy calls client.resolveRole() with correct orgId+role", async () => {
      const mockClient = OrgAIClient.prototype;
      (mockClient.getOrgFromApiKey as jest.Mock).mockResolvedValue({ orgId: "org_1" });
      (mockClient.resolveRole as jest.Mock).mockResolvedValue({
        role: { name: "junior", displayName: "Junior" },
        policies: [],
        resolvedFrom: []
      });

      const result = await mockTools.get_policy({ userRole: "junior" });
      expect(mockClient.resolveRole).toHaveBeenCalledWith("org_1", "junior");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.role).toBe("junior");
    });

    it("9. list_roles calls client.listRoles() and returns role list", async () => {
      const mockClient = OrgAIClient.prototype;
      (mockClient.getOrgFromApiKey as jest.Mock).mockResolvedValue({ orgId: "org_1" });
      (mockClient.listRoles as jest.Mock).mockResolvedValue({ roles: [{ name: "admin" }] });

      const result = await mockTools.list_roles();
      expect(mockClient.listRoles).toHaveBeenCalledWith("org_1");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.roles).toHaveLength(1);
    });

    it("10. check_compliance in API mode surfaces violations from client.check() response", async () => {
      const mockClient = OrgAIClient.prototype;
      (mockClient.getOrgFromApiKey as jest.Mock).mockResolvedValue({ orgId: "org_1" });
      (mockClient.check as jest.Mock).mockResolvedValue({
        passed: false,
        violations: [{ policyName: "no-hardcoded-secrets", severity: "ERROR" }]
      });

      const result = await mockTools.check_compliance({ code: "const secret = 'abc'", filePath: "index.ts", userRole: "junior" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.passed).toBe(false);
      expect(parsed.violations[0].policyName).toBe("no-hardcoded-secrets");
      expect(parsed.blockerCount).toBe(1);
    });
  });
});
