import { OrgAIClient } from './orgai-client';

async function main() {
  const apiKey = 'oai_7cfd50c56889cc7ae763f2d1e8d00020c6ec5db8ea75efbb5fbcc55b6b0061cc';
  const client = new OrgAIClient(apiKey, 'http://localhost:8080');

  console.log('Connecting to OrgAI API...');
  const orgInfo = await client.getOrgInfo();
  console.log(`Connected to: ${orgInfo.orgName} (ID: ${orgInfo.orgId})`);

  console.log('Fetching policies for Junior Developer...');
  const resolveRes = await client.resolveRole(orgInfo.orgId, 'junior');
  console.log(`Found ${resolveRes.policies.length} policies.`);

  console.log('Simulating a blocked code edit...');
  await client.reportViolation(orgInfo.orgId, {
    type: 'code',
    content: 'const aws_secret = "AKIAIOSFODNN7EXAMPLE";',
    filePath: '/src/config.ts',
    roleName: 'junior'
  });
  console.log('Violation reported!');

  console.log('Simulating a blocked command...');
  await client.reportViolation(orgInfo.orgId, {
    type: 'command',
    content: 'git push origin main --force',
    filePath: '/repo/root',
    roleName: 'junior'
  });
  console.log('Violation reported!');
}

main().catch(console.error);
