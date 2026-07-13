// Starter roles + policies seeded into an empty org (mirrors the bundled
// standalone policy pack in src/mcp/policies.json).

type StarterPolicy = {
  name: string;
  rule: string;
  skill: string;
  evaluatorType: 'regex' | 'command' | 'none';
  evaluatorPattern?: string;
  evaluatorFlags?: string;
  fixSuggestion: string;
  severity: 'ERROR' | 'WARNING';
};

type StarterRole = {
  name: string;
  displayName: string;
  inheritsFrom?: string;
  policies: StarterPolicy[];
};

export const STARTER_ROLES: StarterRole[] = [
  {
    name: 'cto',
    displayName: 'CTO / Security',
    policies: [
      {
        name: 'no-hardcoded-secrets',
        rule: 'Never hardcode secrets, API keys, or credentials in source code.',
        skill: 'If you need a secret or API key, always read it from process.env.YOUR_KEY_NAME. Never assign a string literal to a variable named key, secret, password, token, api_key, or credential.',
        evaluatorType: 'regex',
        evaluatorPattern: "(api_key|secret|password|token|apikey|api_secret|pass)\\s*=\\s*['\"][^'\"]{8,}['\"]",
        evaluatorFlags: 'i',
        fixSuggestion: 'Move the value to a .env file and read it with process.env.YOUR_KEY_NAME.',
        severity: 'ERROR',
      },
      {
        name: 'no-credentials-in-urls',
        rule: 'Never embed credentials in connection strings or URLs.',
        skill: 'Connection strings must come from process.env, never inline. A URL containing user:password@ is a leaked credential the moment it is committed.',
        evaluatorType: 'regex',
        // scheme://user:pass@host — catches postgres://, mongodb://, amqp://, https:// etc.
        evaluatorPattern: "[a-z][a-z0-9+.-]*:\\/\\/[^\\/\\s:@'\"]+:[^\\/\\s:@'\"]+@",
        evaluatorFlags: 'i',
        fixSuggestion: 'Read the full connection string from process.env.DATABASE_URL (or equivalent) instead of embedding credentials.',
        severity: 'ERROR',
      },
      {
        name: 'require-unit-tests',
        rule: 'Every function that modifies data must have at least one unit test.',
        skill: 'After writing any function that creates, updates, or deletes data, always write a corresponding test file with at least one test case covering the happy path.',
        evaluatorType: 'none',
        fixSuggestion: 'Add a test file alongside this function before committing.',
        severity: 'WARNING',
      },
      {
        name: 'approved-packages-only',
        rule: 'Only use libraries from the approved list.',
        skill: 'Before installing any package, check whether it is on the org-approved list. Dev dependencies (@types/*, jest, ts-jest, typescript, ts-node, nodemon) are always permitted.',
        evaluatorType: 'command',
        evaluatorPattern: 'npm\\s+(install|i|add)|yarn\\s+(add)|pnpm\\s+(add)',
        fixSuggestion: 'Request approval for this package from your engineering lead before installing.',
        severity: 'ERROR',
      },
      {
        name: 'no-force-push',
        rule: 'Never force-push to shared branches.',
        skill: 'Never run git push --force or git push -f against main, master, develop or release branches. Use --force-with-lease on your own feature branches only.',
        evaluatorType: 'command',
        evaluatorPattern: 'git\\s+push\\s+(-f|--force)(?!-with-lease)',
        fixSuggestion: 'Use git push --force-with-lease on your own branch, or open a PR instead.',
        severity: 'ERROR',
      },
    ],
  },
  {
    name: 'lead',
    displayName: 'Tech Lead',
    inheritsFrom: 'cto',
    policies: [
      {
        name: 'jsdoc-required',
        rule: 'Public functions must have JSDoc comments.',
        skill: 'When writing an exported function, add a JSDoc block describing parameters and return value.',
        evaluatorType: 'none',
        fixSuggestion: 'Add a JSDoc comment above the exported function.',
        severity: 'WARNING',
      },
      {
        name: 'no-console-log',
        rule: 'No console.log in production code — use the logger.',
        skill: 'Use the project logger instead of console.log. console.log is only acceptable inside files whose path contains "logger".',
        evaluatorType: 'regex',
        evaluatorPattern: 'console\\.log\\(',
        fixSuggestion: 'Replace console.log with the project logger.',
        severity: 'ERROR',
      },
    ],
  },
  {
    name: 'senior',
    displayName: 'Senior Developer',
    inheritsFrom: 'lead',
    policies: [
      {
        name: 'adr-comment-required',
        rule: 'Significant architectural changes need an ADR reference.',
        skill: 'When making an architectural change (new service, new dependency layer, changed data flow), reference the ADR document in a comment.',
        evaluatorType: 'none',
        fixSuggestion: 'Add a comment referencing the relevant ADR, or write one.',
        severity: 'WARNING',
      },
    ],
  },
  {
    name: 'junior',
    displayName: 'Junior Developer',
    inheritsFrom: 'lead',
    policies: [],
  },
];
