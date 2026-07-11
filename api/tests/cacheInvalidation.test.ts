import request from 'supertest';
import app from '../src/index';

describe('Resolve cache invalidation', () => {
  let adminToken: string;
  let orgId: string;
  let apiKeyValue: string;
  let roleId: string;
  const roleName = `cache-role-${Date.now()}`;

  beforeAll(async () => {
    const signupRes = await request(app).post('/v1/auth/signup').send({
      email: `cache-${Date.now()}@example.com`,
      password: 'password123',
      firstName: 'Cache',
      lastName: 'Test',
      orgName: 'Cache Org',
      orgSlug: `cache-org-${Date.now()}`
    });
    adminToken = signupRes.body.token;
    orgId = signupRes.body.org.id;

    // Create API key
    const keyRes = await request(app)
      .post(`/v1/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'cache-key', scopes: ['resolve:read'] });
    apiKeyValue = keyRes.body.key;

    // Create a role
    const roleRes = await request(app)
      .post(`/v1/orgs/${orgId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: roleName, displayName: 'Cache Role' });
    roleId = roleRes.body.role.id;
  });

  it('should return updated policies after a new policy is created and bound', async () => {
    // Resolve before adding policy — should have 0 policies
    const before = await request(app)
      .get(`/v1/orgs/${orgId}/resolve/${roleName}`)
      .set('X-API-Key', apiKeyValue);
    expect(before.status).toBe(200);
    expect(before.body.policies.length).toBe(0);

    // Create a policy bound to this role
    await request(app)
      .post(`/v1/orgs/${orgId}/policies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `cache-policy-${Date.now()}`,
        rule: 'No caching bugs',
        severity: 'ERROR',
        evaluatorType: 'none',
        fixSuggestion: 'fix it',
        roleIds: [roleId]
      });

    // Resolve again — should now see the new policy (cache was invalidated)
    const after = await request(app)
      .get(`/v1/orgs/${orgId}/resolve/${roleName}`)
      .set('X-API-Key', apiKeyValue);
    expect(after.status).toBe(200);
    expect(after.body.policies.length).toBe(1);
  });
});
