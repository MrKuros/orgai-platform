import { Evaluator } from '../evaluator';
import { ResolvedPolicy } from '../types/policy';

describe('Evaluator', () => {
  const mockPolicies: ResolvedPolicy[] = [
    {
      id: 'no-hardcoded-secrets',
      rule: 'Never hardcode secrets, API keys, or credentials in source code.',
      skill: 'Use process.env',
      evaluator: {
        type: 'regex',
        pattern: '(api_key|secret|password|token|apikey|api_secret|pass)\\s*=\\s*[\'"][^\'"]{8,}[\'"]',
        flags: 'i'
      },
      fix_suggestion: 'Use environment variables instead.',
      severity: 'error',
      setByRole: 'cto',
      setByDisplayName: 'CTO / Security',
    },
    {
      id: 'no-console-log',
      rule: 'Do not use console.log in production code — use the internal logger.',
      skill: 'Use logger',
      evaluator: {
        type: 'regex',
        pattern: 'console\\.(log|error|warn|info)\\s*\\(',
        flags: ''
      },
      fix_suggestion: 'Replace console methods with the internal logger (e.g. logger.info()).',
      severity: 'warning',
      setByRole: 'lead',
      setByDisplayName: 'Engineering Lead',
    },
    {
      id: 'approved-packages-only',
      rule: 'Only use libraries from the approved list: lodash, axios, zod, express, pg, prisma.',
      skill: 'Check approved list',
      evaluator: {
        type: 'command',
        pattern: 'npm\\s+(install|i|add)|yarn\\s+(add)|pnpm\\s+(add)'
      },
      fix_suggestion: 'Request approval for this package from your engineering lead.',
      severity: 'error',
      setByRole: 'cto',
      setByDisplayName: 'CTO / Security',
    },
    {
      id: 'no-force-push',
      rule: 'Do not use git push --force or --force-with-lease.',
      skill: 'Resolve conflicts properly',
      evaluator: {
        type: 'command',
        pattern: 'git push.*(--force(-with-lease)?|-f\\b)'
      },
      fix_suggestion: 'Use git pull --rebase then git push and resolve any conflicts manually.',
      severity: 'error',
      setByRole: 'cto',
      setByDisplayName: 'CTO / Security',
    },
    {
      id: 'jsdoc-required',
      rule: 'All public-facing functions must have JSDoc comments.',
      skill: 'Add JSDoc',
      evaluator: {
        type: 'none'
      },
      fix_suggestion: 'Add a JSDoc comment block above this function.',
      severity: 'warning',
      setByRole: 'lead',
      setByDisplayName: 'Engineering Lead',
    }
  ];

  let evaluator: Evaluator;

  beforeEach(() => {
    evaluator = new Evaluator(mockPolicies);
  });

  describe('evaluateCode', () => {
    test('Hardcoded secrets are blocked', () => {
      const code = 'const API_KEY = "sk-abc123456789";';
      const results = evaluator.evaluateCode(code, 'src/api.ts');
      expect(results.length).toBe(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].policyName).toBe('no-hardcoded-secrets');
      expect(results[0].severity).toBe('error');
    });

    test('Password variables are blocked', () => {
      const code = 'const password = "supersecret123";';
      const results = evaluator.evaluateCode(code, 'src/auth.ts');
      expect(results.length).toBe(1);
      expect(results[0].passed).toBe(false);
    });

    test('Short/common names pass', () => {
      const code = 'const name = "john";';
      const results = evaluator.evaluateCode(code, 'src/user.ts');
      expect(results.length).toBe(0);
    });

    test('console.log is a warning in general files', () => {
      const code = 'console.log("hello");';
      const results = evaluator.evaluateCode(code, 'src/api.ts');
      expect(results.length).toBe(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].setBy).toBe('Engineering Lead');
      expect(results[0].severity).toBe('warning');
    });

    test('console.log is allowed in logger files', () => {
      const code = 'console.log("system message");';
      expect(evaluator.evaluateCode(code, 'src/logger.ts').length).toBe(0);
      expect(evaluator.evaluateCode(code, 'src/utils/logger-server.ts').length).toBe(0);
    });

    test('Path traversal is blocked with error severity', () => {
      const results = evaluator.evaluateCode('// code', '../../etc/passwd');
      expect(results.length).toBe(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].severity).toBe('error');
      expect(results[0].description).toMatch(/path traversal/);
    });

    test('Absolute paths are blocked', () => {
      const results = evaluator.evaluateCode('// code', '/tmp/file.ts');
      expect(results.length).toBe(1);
      expect(results[0].passed).toBe(false);
    });

    test('Internal workspace paths pass', () => {
      expect(evaluator.evaluateCode('// code', 'src/api.ts').length).toBe(0);
      expect(evaluator.evaluateCode('// code', 'src/nested/deep/file.ts').length).toBe(0);
    });

    test('Type: "none" evaluator always passes deterministic check', () => {
      // 'jsdoc-required' has type "none", so it should never flag code during the regex pass
      const code = 'export function foo() { return 1; }';
      const results = evaluator.evaluateCode(code, 'src/foo.ts');
      expect(results.length).toBe(0);
    });
  });

  describe('evaluateCommand', () => {
    test('git push --force is blocked', () => {
      const results = evaluator.evaluateCommand('git push --force');
      expect(results.length).toBe(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].policyName).toBe('no-force-push');
    });

    test('git push --force-with-lease is blocked', () => {
      const results = evaluator.evaluateCommand('git push --force-with-lease');
      expect(results.length).toBe(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].policyName).toBe('no-force-push');
    });

    test('git push -f is blocked', () => {
      const results = evaluator.evaluateCommand('git push -f');
      expect(results.length).toBe(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].policyName).toBe('no-force-push');
    });

    test('git push origin main passes', () => {
      const results = evaluator.evaluateCommand('git push origin main');
      expect(results.length).toBe(0);
    });

    test('Approved packages pass', () => {
      expect(evaluator.evaluateCommand('npm install express').length).toBe(0);
      expect(evaluator.evaluateCommand('npm install lodash').length).toBe(0);
      expect(evaluator.evaluateCommand('yarn add zod').length).toBe(0);
    });

    test('Unapproved packages are blocked', () => {
      const results = evaluator.evaluateCommand('npm install stripe');
      expect(results.length).toBe(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].setBy).toBe('CTO / Security');
      
      expect(evaluator.evaluateCommand('npm install mongoose')[0].passed).toBe(false);
      expect(evaluator.evaluateCommand('yarn add puppeteer')[0].passed).toBe(false);
    });

    test('Dev dependency exemption passes', () => {
      expect(evaluator.evaluateCommand('npm install --save-dev jest').length).toBe(0);
      expect(evaluator.evaluateCommand('npm install -D typescript').length).toBe(0);
    });

    test('@types exemption passes', () => {
      expect(evaluator.evaluateCommand('npm install --save-dev @types/express').length).toBe(0);
      expect(evaluator.evaluateCommand('npm install --save-dev @types/stripe').length).toBe(0);
    });

    test('Scoped package not in approved list is blocked', () => {
      const results = evaluator.evaluateCommand('npm install @org/internal-tool');
      expect(results.length).toBe(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].description).toMatch(/Package "@org\/internal-tool" is not in the approved list/);
    });
  });

  describe('formatViolations', () => {
    test('Formats errors correctly with fix_suggestion', () => {
      const results = evaluator.evaluateCode('const API_KEY = "sk-abc123456789";', 'src/api.ts');
      const formatted = Evaluator.formatViolations(results);
      expect(formatted).toContain('⛔ Action blocked');
      expect(formatted).toContain('Fix: Use environment variables instead.');
    });

    test('Formats warnings correctly without blocking', () => {
      const results = evaluator.evaluateCode('console.log("hello");', 'src/api.ts');
      const formatted = Evaluator.formatViolations(results);
      expect(formatted).not.toContain('⛔ Action blocked');
      expect(formatted).toContain('⚠ Warning — no-console-log');
      expect(formatted).toContain('Replace console methods with the internal logger');
    });
  });
});
