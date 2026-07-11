import request from 'supertest';
import app from '../src/index';

describe('Role cycle detection', () => {
  let adminToken: string;
  let orgId: string;

  beforeAll(async () => {
    const signupRes = await request(app).post('/v1/auth/signup').send({
      email: `cycle-${Date.now()}@example.com`,
      password: 'password123',
      firstName: 'Cycle',
      lastName: 'Test',
      orgName: 'Cycle Org',
      orgSlug: `cycle-org-${Date.now()}`
    });
    adminToken = signupRes.body.token;
    orgId = signupRes.body.org.id;
  });

  it('should reject self-inheritance on update', async () => {
    // Create a role
    const createRes = await request(app)
      .post(`/v1/orgs/${orgId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'self-ref', displayName: 'Self Ref' });
    expect(createRes.status).toBe(201);
    const roleId = createRes.body.role.id;

    // Try to make it inherit from itself
    const updateRes = await request(app)
      .patch(`/v1/orgs/${orgId}/roles/${roleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ inheritsFromId: roleId });

    expect(updateRes.status).toBe(400);
    expect(updateRes.body.error.code).toBe('CYCLE_DETECTED');
  });

  it('should reject A -> B -> A cycle on update', async () => {
    // Create role A
    const aRes = await request(app)
      .post(`/v1/orgs/${orgId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `role-a-${Date.now()}`, displayName: 'Role A' });
    const roleAId = aRes.body.role.id;

    // Create role B that inherits from A
    const bRes = await request(app)
      .post(`/v1/orgs/${orgId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `role-b-${Date.now()}`, displayName: 'Role B', inheritsFromId: roleAId });
    const roleBId = bRes.body.role.id;

    // Try to make A inherit from B (creating a cycle)
    const updateRes = await request(app)
      .patch(`/v1/orgs/${orgId}/roles/${roleAId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ inheritsFromId: roleBId });

    expect(updateRes.status).toBe(400);
    expect(updateRes.body.error.code).toBe('CYCLE_DETECTED');
  });
});
