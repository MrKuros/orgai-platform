import request from 'supertest';
import app from '../src/index';

describe('Audit Pagination', () => {
  let adminToken: string;
  let orgId: string;

  beforeAll(async () => {
    const adminRes = await request(app).post('/v1/auth/signup').send({
      email: `audit-${Date.now()}@example.com`,
      password: 'password123',
      firstName: 'Audit',
      lastName: 'User',
      orgName: 'Audit Org',
      orgSlug: `audit-org-${Date.now()}`
    });
    adminToken = adminRes.body.token;
    orgId = adminRes.body.org.id;
  });

  it('cursor pagination should not skip items', async () => {
    // Generate some audit logs by creating roles
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `role-test-${Date.now()}-${i}`, displayName: `Role ${i}` });
    }

    // Get first page, limit 1
    const res1 = await request(app)
      .get(`/v1/orgs/${orgId}/audit?limit=1`)
      .set('Authorization', `Bearer ${adminToken}`);
    
    expect(res1.status).toBe(200);
    expect(res1.body.data.length).toBe(1);
    
    const nextCursor = res1.body.nextCursor;
    expect(nextCursor).toBeDefined();

    // Get second page using cursor
    const res2 = await request(app)
      .get(`/v1/orgs/${orgId}/audit?limit=1&cursor=${nextCursor}`)
      .set('Authorization', `Bearer ${adminToken}`);
    
    expect(res2.status).toBe(200);
    expect(res2.body.data.length).toBe(1);
    expect(res2.body.data[0].id).not.toBe(res1.body.data[0].id);
  });
});
