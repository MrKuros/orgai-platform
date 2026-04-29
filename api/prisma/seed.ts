import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding demo data...');

  const passwordHash = await bcrypt.hash('password123', 12);

  const org = await prisma.organization.create({
    data: { name: 'Acme Corp', slug: 'acme' }
  });

  const adminUser = await prisma.user.create({
    data: { email: 'admin@acme.com', passwordHash, firstName: 'Admin', lastName: 'Acme' }
  });

  const leadUser = await prisma.user.create({
    data: { email: 'lead@acme.com', passwordHash, firstName: 'Lead', lastName: 'Acme' }
  });

  const devUser = await prisma.user.create({
    data: { email: 'dev@acme.com', passwordHash, firstName: 'Dev', lastName: 'Acme' }
  });

  await prisma.membership.createMany({
    data: [
      { orgId: org.id, userId: adminUser.id, role: 'ORG_ADMIN' },
      { orgId: org.id, userId: leadUser.id, role: 'POLICY_ADMIN' },
      { orgId: org.id, userId: devUser.id, role: 'MEMBER' },
    ]
  });

  const ctoRole = await prisma.role.create({
    data: { orgId: org.id, name: 'cto', displayName: 'CTO' }
  });

  const leadRole = await prisma.role.create({
    data: { orgId: org.id, name: 'lead', displayName: 'Lead', inheritsFromId: ctoRole.id }
  });

  const seniorRole = await prisma.role.create({
    data: { orgId: org.id, name: 'senior', displayName: 'Senior', inheritsFromId: leadRole.id }
  });

  const juniorRole = await prisma.role.create({
    data: { orgId: org.id, name: 'junior', displayName: 'Junior', inheritsFromId: leadRole.id }
  });

  const policies = [
    {
      roleId: ctoRole.id,
      name: 'no-hardcoded-secrets',
      rule: 'Never hardcode secrets, API keys, or credentials in source code.',
      skill: 'Always read secrets from process.env. Never assign string literals to variables named key, secret, password, token, or api_key.',
      evaluatorType: 'regex',
      evaluatorPattern: '(api_key|secret|password|token)\\s*=\\s*[\'"][^\'"]{8,}[\'"]',
      evaluatorFlags: 'i',
      fixSuggestion: 'Move the value to a .env file and read it with process.env.YOUR_KEY_NAME.',
      severity: 'ERROR'
    },
    {
      roleId: ctoRole.id,
      name: 'require-unit-tests',
      rule: 'Every function that modifies data must have at least one unit test.',
      skill: 'After writing any function that creates, updates, or deletes data, always write a corresponding test file.',
      evaluatorType: 'none',
      fixSuggestion: 'Add a test file alongside this function before committing.',
      severity: 'WARNING'
    },
    {
      roleId: ctoRole.id,
      name: 'approved-packages-only',
      rule: 'Only use libraries from the approved list: lodash, axios, zod, express, pg, prisma.',
      skill: 'Before installing any package check the approved list. Dev dependencies (@types/*, jest, ts-jest, typescript, ts-node, nodemon) are always permitted.',
      evaluatorType: 'command',
      evaluatorPattern: 'npm (install|i|add)|yarn (add)',
      fixSuggestion: 'Request approval for this package from your engineering lead.',
      severity: 'ERROR'
    },
    {
      roleId: ctoRole.id,
      name: 'no-force-push',
      rule: 'Do not use git push --force or --force-with-lease.',
      skill: 'Never use git push --force or --force-with-lease. Use git pull --rebase then git push.',
      evaluatorType: 'command',
      evaluatorPattern: 'git push.*(--force(-with-lease)?|-f\\b)',
      fixSuggestion: 'Use git pull --rebase then git push and resolve conflicts manually.',
      severity: 'ERROR'
    },
    {
      roleId: leadRole.id,
      name: 'no-console-log',
      rule: 'Do not use console.log in production code — use the internal logger.',
      skill: 'Never use console.log(), console.warn(), or console.error(). Always import the logger and use logger.info(), logger.warn(), or logger.error().',
      evaluatorType: 'regex',
      evaluatorPattern: 'console\\.(log|warn|error)\\s*\\(',
      evaluatorFlags: '',
      fixSuggestion: 'Replace console.log with logger.info (import logger from \'./logger\').',
      severity: 'ERROR'
    },
    {
      roleId: leadRole.id,
      name: 'jsdoc-required',
      rule: 'All public-facing functions must have JSDoc comments.',
      skill: 'Before writing any exported function always add a JSDoc comment block above it.',
      evaluatorType: 'none',
      fixSuggestion: 'Add a JSDoc comment block above this function.',
      severity: 'WARNING'
    },
    {
      roleId: seniorRole.id,
      name: 'adr-comment-required',
      rule: 'All new modules must include an architecture decision record (ADR) comment at the top.',
      skill: 'When creating a new file always start with a comment block explaining why this module exists.',
      evaluatorType: 'none',
      fixSuggestion: 'Add an ADR comment block at the top of this file.',
      severity: 'WARNING'
    }
  ];

  for (const policyConfig of policies) {
    const { roleId, ...policyData } = policyConfig;
    const policy = await prisma.policy.create({
      data: {
        orgId: org.id,
        ...policyData as any
      }
    });

    await prisma.policyBinding.create({
      data: {
        roleId: roleId,
        policyId: policy.id
      }
    });
  }

  const rawKey = `oai_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 12);

  await prisma.apiKey.create({
    data: {
      orgId: org.id,
      createdById: adminUser.id,
      name: 'Test Key',
      keyHash,
      keyPrefix,
      scopes: ['check', 'resolve']
    }
  });

  console.log('Seed successful!');
  console.log('----------------------------------------------------');
  console.log(`Demo Org: ${org.name} (slug: ${org.slug})`);
  console.log(`API Key (SAVE THIS): ${rawKey}`);
  console.log('Users:');
  console.log('  admin@acme.com / password123');
  console.log('  lead@acme.com / password123');
  console.log('  dev@acme.com / password123');
  console.log('----------------------------------------------------');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
