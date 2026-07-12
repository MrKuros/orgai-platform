// Fail-closed guarantees in the real (unmocked) @comply/core engine.
import { PolicyEngine, Evaluator } from "@comply/core";

const config = {
  currentUserRole: "junior",
  hierarchy: [
    {
      role: "junior",
      displayName: "Junior",
      policies: [
        { id: "p1", rule: "no secrets", skill: "", evaluator: { type: "regex", pattern: "SECRET" }, fix_suggestion: "x", severity: "error" },
      ],
    },
  ],
};

function loadedEngine(): PolicyEngine {
  const e = new PolicyEngine({});
  // Inject config directly so the test needs no fixture files.
  (e as any).config = config;
  return e;
}

describe("PolicyEngine fail-closed", () => {
  it("throws on an unknown role instead of an empty-chain pass", () => {
    expect(() => loadedEngine().resolve("typo-role")).toThrow(/Unknown role/);
  });

  it("resolves a known role", () => {
    const e = loadedEngine();
    e.resolve("junior");
    expect(e.getResolvedPolicies()).toHaveLength(1);
  });
});

describe("Evaluator path-traversal guard", () => {
  it("blocks .. escaping the root", () => {
    const v = new Evaluator([]).evaluateCode("x", "../../etc/passwd");
    expect(v.some((r) => r.policyId === "path-traversal")).toBe(true);
  });

  it("allows plain absolute MCP paths (no false positive)", () => {
    const v = new Evaluator([]).evaluateCode("x", "/home/user/project/src/index.ts");
    expect(v.some((r) => r.policyId === "path-traversal")).toBe(false);
  });
});
