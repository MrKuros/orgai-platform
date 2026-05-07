import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: 'acme' } });
  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@acme.com' } });

  if (!org || !adminUser) {
    console.error('Org or admin user not found. Please run db:seed first.');
    process.exit(1);
  }

  const rawKey = `oai_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 12);

  await prisma.apiKey.create({
    data: {
      orgId: org.id,
      createdById: adminUser.id,
      name: 'Generated E2E Test Key',
      keyHash,
      keyPrefix,
      scopes: ['check', 'resolve']
    }
  });

  console.log('--- NEW API KEY GENERATED ---');
  console.log(`Demo Org: ${org.name}`);
  console.log(`Raw Key: ${rawKey}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
