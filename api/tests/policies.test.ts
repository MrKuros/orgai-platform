import request from 'supertest';
import app from '../src/index';

describe('Policies Routes', () => {
  let adminToken: string;
  let orgId: string;
  let policyId: string;

  beforeAll(async () => {
    const adminRes = await request(app).post('/v1/auth/signup').send({
      email: `admin-${Date.now()}@example.com`,
      password: 'password123',
      firstName: 'Admin',
      lastName: 'User',
      orgName: 'Test Org Policies',
      orgSlug: `test-org-pol-${Date.now()}`
    });
    adminToken = adminRes.body.token;
    orgId = adminRes.body.org.id;

    const createRes = await request(app)
      .post(`/v1/orgs/${orgId}/policies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Secret Policy',
        rule: 'No secrets',
        severity: 'ERROR',
        evaluatorType: 'none',
        fixSuggestion: 'remove it'
      });
    policyId = createRes.body.policy.id;
  });

  it('GET /v1/orgs/:orgId/policies/:policyId/versions checks org isolation', async () => {
    // Create a SECOND org
    const adminRes2 = await request(app).post('/v1/auth/signup').send({
      email: `admin2-${Date.now()}@example.com`,
      password: 'password123',
      firstName: 'Admin2',
      lastName: 'User2',
      orgName: 'Test Org 2',
      orgSlug: `test-org-2-${Date.now()}`
    });
    const token2 = adminRes2.body.token;
    const orgId2 = adminRes2.body.org.id;

    // Try to access the first org's policy from the second org
    const res = await request(app)
      .get(`/v1/orgs/${orgId2}/policies/${policyId}/versions`)
      .set('Authorization', `Bearer ${token2}`);
    
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
