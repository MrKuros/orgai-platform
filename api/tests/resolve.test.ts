import request from 'supertest';
import app from '../src/index';

describe('Resolve & Check Routes', () => {
  let adminToken: string;
  let orgId: string;
  let apiKey: string;
  let ctoRoleId: string;
  let juniorRoleId: string;

  beforeAll(async () => {
    const adminRes = await request(app).post('/v1/auth/signup').send({
      email: 'admin@resolve.com',
      password: 'password123',
      firstName: 'Admin',
      lastName: 'User',
      orgName: 'Resolve Org',
      orgSlug: 'resolve-org'
    });
    adminToken = adminRes.body.token;
    orgId = adminRes.body.org.id;

    const ctoRes = await request(app)
      .post(`/v1/orgs/${orgId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'cto', displayName: 'CTO' });
    ctoRoleId = ctoRes.body.role.id;

    const juniorRes = await request(app)
      .post(`/v1/orgs/${orgId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'junior', displayName: 'Junior', inheritsFromId: ctoRoleId });
    juniorRoleId = juniorRes.body.role.id;

    await request(app)
      .post(`/v1/orgs/${orgId}/policies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'no-secret',
        rule: 'No secrets',
        evaluatorType: 'regex',
        evaluatorPattern: 'secret=.*',
        severity: 'ERROR',
        roleIds: [ctoRoleId]
      });

    // Create a conflicting policy on Junior role (same name as CTO's policy)
    await request(app)
      .post(`/v1/orgs/${orgId}/policies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'no-secret',
        rule: 'Different rule - secrets are allowed in junior mode',
        evaluatorType: 'none',
        severity: 'WARNING',
        roleIds: [juniorRoleId]
      });

    const keyRes = await request(app)
      .post(`/v1/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test Key' });
    apiKey = keyRes.body.key;
  });

  it('GET /v1/orgs/:orgId/resolve/junior with API key -> 200, returns policies including inherited', async () => {
    const res = await request(app)
      .get(`/v1/orgs/${orgId}/resolve/junior`)
      .set('x-api-key', apiKey);
    expect(res.status).toBe(200);
    expect(res.body.policies.length).toBe(1);
    expect(res.body.policies[0].name).toBe('no-secret');
    expect(res.body.resolvedFrom).toContain('cto');
  });

  it('GET /v1/orgs/:orgId/resolve/cto with API key -> 200', async () => {
    const res = await request(app)
      .get(`/v1/orgs/${orgId}/resolve/cto`)
      .set('x-api-key', apiKey);
    expect(res.status).toBe(200);
    expect(res.body.policies.length).toBe(1);
  });

  it('POST /v1/orgs/:orgId/check with hardcoded secret -> passed: false', async () => {
    const res = await request(app)
      .post(`/v1/orgs/${orgId}/check`)
      .set('x-api-key', apiKey)
      .send({
        type: 'code',
        content: 'const secret="12345";',
        roleName: 'junior'
      });
    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(false);
    expect(res.body.violations.length).toBe(1);
  });

  it('POST /v1/orgs/:orgId/check with clean code -> passed: true', async () => {
    const res = await request(app)
      .post(`/v1/orgs/${orgId}/check`)
      .set('x-api-key', apiKey)
      .send({
        type: 'code',
        content: 'const a = 1;',
        roleName: 'junior'
      });
    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(true);
  });

  it('POST /v1/orgs/:orgId/check without API key -> 401', async () => {
    const res = await request(app)
      .post(`/v1/orgs/${orgId}/check`)
      .send({
        type: 'code',
        content: 'const a = 1;',
        roleName: 'junior'
      });
    expect(res.status).toBe(401);
  });

  it('GET /v1/orgs/:orgId/resolve/junior returns warning when policy name conflicts with ancestor', async () => {
    const res = await request(app)
      .get(`/v1/orgs/${orgId}/resolve/junior`)
      .set('x-api-key', apiKey);
    expect(res.status).toBe(200);
    // Should have warnings array
    expect(res.body.warnings).toBeDefined();
    expect(res.body.warnings.length).toBe(1);
    expect(res.body.warnings[0].policyName).toBe('no-secret');
    expect(res.body.warnings[0].overriddenByRole).toBe('cto'); // Ancestor (cto) overrides
    expect(res.body.warnings[0].originalRole).toBe('junior');   // Subordinate (junior) was overridden
    // Ancestor's policy should dominate
    expect(res.body.policies.length).toBe(1);
    expect(res.body.policies[0].name).toBe('no-secret');
    expect(res.body.policies[0].rule).toBe('No secrets'); // CTO's rule
    expect(res.body.policies[0].setByRole).toBe('cto');
  });
});
