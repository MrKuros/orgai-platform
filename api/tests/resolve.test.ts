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

  describe('multi-role resolution (comma-separated)', () => {
    beforeAll(async () => {
      // Two department branches under CTO, each with its own policy
      const payRes = await request(app)
        .post(`/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'payments-dev', displayName: 'Payments Dev', inheritsFromId: ctoRoleId });
      const mlRes = await request(app)
        .post(`/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'ml-dev', displayName: 'ML Dev', inheritsFromId: ctoRoleId });

      await request(app)
        .post(`/v1/orgs/${orgId}/policies`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'no-card-numbers',
          rule: 'No raw card numbers',
          evaluatorType: 'regex',
          evaluatorPattern: 'cardNumber\\s*=',
          severity: 'ERROR',
          roleIds: [payRes.body.role.id]
        });
      await request(app)
        .post(`/v1/orgs/${orgId}/policies`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'no-training-data-paths',
          rule: 'No hardcoded training data paths',
          evaluatorType: 'regex',
          evaluatorPattern: 'trainingData\\s*=',
          severity: 'ERROR',
          roleIds: [mlRes.body.role.id]
        });
    });

    it('resolve of two roles returns the union of both chains', async () => {
      const res = await request(app)
        .get(`/v1/orgs/${orgId}/resolve/payments-dev,ml-dev`)
        .set('x-api-key', apiKey);
      expect(res.status).toBe(200);
      const names = res.body.policies.map((p: any) => p.name).sort();
      // union: cto's no-secret + both department policies
      expect(names).toEqual(['no-card-numbers', 'no-secret', 'no-training-data-paths']);
      expect(res.body.resolvedFrom).toEqual(expect.arrayContaining(['cto', 'payments-dev', 'ml-dev']));
      // cto appears once despite being in both chains
      expect(res.body.resolvedFrom.filter((n: string) => n === 'cto').length).toBe(1);
    });

    it('check as both roles enforces policies from each branch', async () => {
      const pay = await request(app)
        .post(`/v1/orgs/${orgId}/check`)
        .set('x-api-key', apiKey)
        .send({ type: 'code', content: 'const cardNumber = "4111"', roleName: 'payments-dev,ml-dev' });
      expect(pay.status).toBe(200);
      expect(pay.body.passed).toBe(false);

      const ml = await request(app)
        .post(`/v1/orgs/${orgId}/check`)
        .set('x-api-key', apiKey)
        .send({ type: 'code', content: 'const trainingData = "/mnt/x"', roleName: 'payments-dev,ml-dev' });
      expect(ml.status).toBe(200);
      expect(ml.body.passed).toBe(false);

      const clean = await request(app)
        .post(`/v1/orgs/${orgId}/check`)
        .set('x-api-key', apiKey)
        .send({ type: 'code', content: 'const a = 1;', roleName: 'payments-dev,ml-dev' });
      expect(clean.status).toBe(200);
      expect(clean.body.passed).toBe(true);
    });

    it('any unknown role in the list fails closed (404)', async () => {
      const res = await request(app)
        .get(`/v1/orgs/${orgId}/resolve/payments-dev,ghost-role`)
        .set('x-api-key', apiKey);
      expect(res.status).toBe(404);
    });
  });
});
