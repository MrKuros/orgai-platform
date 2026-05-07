const fs = require('fs');
const path = require('path');
const { Evaluator } = require('../out/evaluator');

/**
 * AI Tester Script
 * Verifies compliance evaluator logic against representative scenarios.
 */

// 1. Resolve policies manually (avoiding VS Code dependency in PolicyEngine)
const policiesPath = path.resolve(__dirname, '../config/policies.json');
const config = JSON.parse(fs.readFileSync(policiesPath, 'utf-8'));
config.currentUserRole = 'junior';

function resolvePolicies(config) {
  const roleMap = new Map();
  config.hierarchy.forEach((h) => roleMap.set(h.role, h));

  let current = roleMap.get(config.currentUserRole);
  const resolved = [];
  const visited = new Set();
  while (current && !visited.has(current.role)) {
    visited.add(current.role);
    current.policies.forEach((p) => {
      if (typeof p === 'string') {
        resolved.push({ id: 'legacy', rule: p, skill: '', evaluator: { type: 'none' }, fix_suggestion: '', severity: 'error', setByRole: current.role, setByDisplayName: current.displayName });
      } else {
        resolved.push({ ...p, setByRole: current.role, setByDisplayName: current.displayName });
      }
    });
    current = roleMap.get(current.inheritsFrom);
  }
  return resolved;
}

const resolvedPolicies = resolvePolicies(config);
const evaluator = new Evaluator(resolvedPolicies);

const tests = [
  // Fixed Tests
  {
    name: 'Test 1: secret injection blocked',
    type: 'code',
    input: 'const DB_PASS = "supersecret123"',
    file: 'src/api.ts',
    expected: false,
  },
  {
    name: 'Test 2: unapproved package blocked',
    type: 'command',
    input: 'npm install stripe',
    expected: false,
  },
  {
    name: 'Test 3: force push blocked',
    type: 'command',
    input: 'git push --force',
    expected: false,
  },
  {
    name: 'Test 4: clean function passed',
    type: 'code',
    input: '/** @returns {string} */ function greet(name) { return name; }',
    file: 'src/utils.ts',
    expected: true,
  },
  {
    name: 'Test 5: approved package passed',
    type: 'command',
    input: 'npm install express',
    expected: true,
  },

  // Junior Dev Realistic Prompts
  {
    name: 'Junior: Dirty debug log',
    type: 'code',
    input: 'console.log("debugging bug 123");',
    file: 'src/app.ts',
    expected: false,
  },
  {
    name: 'Junior: Unapproved library',
    type: 'command',
    input: 'npm install moment',
    expected: false,
  },
  {
    name: 'Junior: Safe debug log',
    type: 'code',
    input: 'logger.error("Failed to process request: " + err.message);',
    file: 'src/server.ts',
    expected: true,
  },
  {
    name: 'Junior: Helper function',
    type: 'code',
    input: 'export function formatDate(d) { return d.toISOString(); }',
    file: 'src/helpers.ts',
    expected: true,
  },
  {
    name: 'Junior: Normal git commit',
    type: 'command',
    input: 'git commit -m "fix: logic error in login"',
    expected: true,
  },

  // Regex Boundary Edge Cases
  {
    name: 'Edge: Env var secret (safe)',
    type: 'code',
    input: 'const token = process.env.API_TOKEN',
    file: 'src/api.ts',
    expected: true,
  },
  {
    name: 'Edge: Dev safe dependency',
    type: 'command',
    input: 'npm install --save-dev nodemon',
    expected: true,
  },
  {
    name: 'Edge: console.error coverage',
    type: 'code',
    input: 'console.error("fatal error")',
    file: 'src/api.ts',
    expected: false,
  },
];

const results = [];
let bugs = [];

console.log('===== Comply AI Tester =====\n');

for (const t of tests) {
  const violations =
    t.type === 'code' ? evaluator.evaluateCode(t.input, t.file) : evaluator.evaluateCommand(t.input);

  const errors = violations.filter(v => v.severity === 'error');
  const passed = errors.length === 0;
  const status = passed ? 'PASSED' : 'BLOCKED';
  const detail = !passed ? `(${errors[0].policyName} — set by ${errors[0].setBy})` : '';

  if (passed !== t.expected) {
    const bugMsg = `BUG: "${t.input}" expected ${t.expected ? 'PASSED' : 'BLOCKED'} but got ${status}`;
    bugs.push(bugMsg);
  }

  results.push({ name: t.name, input: t.input, status, detail, success: passed === t.expected });
}

console.log('Fixed Tests:');
results.slice(0, 5).forEach((r) => {
  console.log(`${r.success ? 'PASS' : 'FAIL'} ${r.name}`);
});

console.log('\nAI-Generated Edge Cases:');
results.slice(5).forEach((r) => {
  console.log(`- "${r.input}" → ${r.status} ${r.detail}`);
});

console.log(`\nSummary: ${results.filter((r) => r.success).length}/${results.length} tests behaved as expected`);

if (bugs.length > 0) {
  console.log('Unexpected results:');
  bugs.forEach((b) => console.log(b));
  console.log('===========================\n');
  process.exit(1);
} else {
  console.log('Unexpected results: none');
  console.log('===========================\n');
  process.exit(0);
}
