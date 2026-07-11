import request from 'supertest';
import app from '../src/index';

describe('authOrApiKey middleware', () => {
  let orgId: string;
  let apiKeyValue: string;
  let adminToken: string;

  beforeAll(async () => {
    // Create user + org
    const signupRes = await request(app).post('/v1/auth/signup').send({
      email: `authtest-${Date.now()}@example.com`,
      password: 'password123',
      firstName: 'Auth',
      lastName: 'Test',
      orgName: 'Auth Test Org',
      orgSlug: `auth-test-${Date.now()}`
    });
    adminToken = signupRes.body.token;
    orgId = signupRes.body.org.id;

    // Create an API key
    const keyRes = await request(app)
      .post(`/v1/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'test-key', scopes: ['resolve:read', 'audit:read'] });
    apiKeyValue = keyRes.body.key;
  });

  it('should prefer X-API-Key over an invalid Bearer token', async () => {
    const res = await request(app)
      .get(`/v1/orgs/${orgId}/policies`)
      .set('Authorization', 'Bearer invalid-expired-token')
      .set('X-API-Key', apiKeyValue);

    // Should succeed using the API key, not fail on the bad Bearer token
    expect(res.status).toBe(200);
    expect(res.body.policies).toBeDefined();
  });

  it('should work with just an API key', async () => {
    const res = await request(app)
      .get(`/v1/orgs/${orgId}/policies`)
      .set('X-API-Key', apiKeyValue);

    expect(res.status).toBe(200);
  });

  it('should work with just a Bearer token', async () => {
    const res = await request(app)
      .get(`/v1/orgs/${orgId}/policies`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  it('should return 401 with no auth at all', async () => {
    const res = await request(app)
      .get(`/v1/orgs/${orgId}/policies`);

    expect(res.status).toBe(401);
  });
});
