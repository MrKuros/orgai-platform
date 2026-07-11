import request from 'supertest';
import app from '../src/index';

describe('API Keys Routes', () => {
  let adminToken: string;
  let orgId: string;
  let apiKeyId: string;

  beforeAll(async () => {
    const adminRes = await request(app).post('/v1/auth/signup').send({
      email: 'admin-keys@example.com',
      password: 'password123',
      firstName: 'Admin',
      lastName: 'User',
      orgName: 'Keys Org',
      orgSlug: 'keys-org'
    });
    adminToken = adminRes.body.token;
    orgId = adminRes.body.org.id;
  });

  it('POST /v1/orgs/:orgId/api-keys -> 201, returns full key', async () => {
    const res = await request(app)
      .post(`/v1/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test Key' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('key');
    expect(res.body.apiKey).toHaveProperty('id');
    apiKeyId = res.body.apiKey.id;
  });

  it('GET /v1/orgs/:orgId/api-keys -> 200, keys do NOT contain keyHash', async () => {
    await request(app)
      .post(`/v1/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test Key 2' });

    const res = await request(app)
      .get(`/v1/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.apiKeys.length).toBeGreaterThan(0);
    expect(res.body.apiKeys[0]).not.toHaveProperty('keyHash');
  });

  it('POST /v1/orgs/:orgId/api-keys -> 402 once the plan limit is reached', async () => {
    // FREE plan allows 5 keys; two already exist from earlier tests
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/v1/orgs/${orgId}/api-keys`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Filler Key ${i}` });
    }

    const res = await request(app)
      .post(`/v1/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Over Limit Key' });

    expect(res.status).toBe(402);

    // Free a slot so later tests are unaffected by the quota
    const list = await request(app)
      .get(`/v1/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`);
    for (const key of list.body.apiKeys.filter((k: any) => k.name.startsWith('Filler Key'))) {
      await request(app)
        .delete(`/v1/orgs/${orgId}/api-keys/${key.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
    }
  });

  it('DELETE /v1/orgs/:orgId/api-keys/:keyId -> 204', async () => {
    const createRes = await request(app)
      .post(`/v1/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test Key Delete' });
    
    const keyId = createRes.body.apiKey.id;

    const res = await request(app)
      .delete(`/v1/orgs/${orgId}/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    
    expect(res.status).toBe(204);
  });
});
