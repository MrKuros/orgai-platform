import request from 'supertest';
import app from '../src/index';

// Per-developer API keys, member deactivation, and policy pack import.
describe('Member-bound keys, deactivation & policy packs', () => {
  let adminToken: string;
  let orgId: string;
  let devMembershipId: string;
  let devUserId: string;
  let devKey: string;
  let orgKey: string;

  beforeAll(async () => {
    const adminRes = await request(app).post('/v1/auth/signup').send({
      email: 'admin@memberkeys.com',
      password: 'password123',
      firstName: 'Admin',
      lastName: 'User',
      orgName: 'MemberKeys Org',
      orgSlug: 'memberkeys-org'
    });
    adminToken = adminRes.body.token;
    orgId = adminRes.body.org.id;

    const roleRes = await request(app)
      .post(`/v1/orgs/${orgId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'backend', displayName: 'Backend' });
    const backendRoleId = roleRes.body.role.id;

    await request(app)
      .post(`/v1/orgs/${orgId}/policies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'no-debugger',
        rule: 'No debugger statements',
        evaluatorType: 'regex',
        evaluatorPattern: '\\bdebugger\\b',
        severity: 'ERROR',
        roleIds: [backendRoleId]
      });

    const inviteRes = await request(app)
      .post(`/v1/orgs/${orgId}/members/invite`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'dev@memberkeys.com', membershipRole: 'MEMBER', assignedRoleIds: [backendRoleId] });
    devMembershipId = inviteRes.body.membership.id;
    devUserId = inviteRes.body.membership.userId;

    const devKeyRes = await request(app)
      .post(`/v1/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Dev Key', memberId: devMembershipId });
    devKey = devKeyRes.body.key;
    expect(devKeyRes.body.apiKey.memberId).toBe(devMembershipId);

    const orgKeyRes = await request(app)
      .post(`/v1/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Org Key' });
    orgKey = orgKeyRes.body.key;
  });

  it('member-bound key checks as the member roles without roleName', async () => {
    const res = await request(app)
      .post(`/v1/orgs/${orgId}/check`)
      .set('x-api-key', devKey)
      .send({ type: 'code', content: 'debugger;' });
    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(false);
    expect(res.body.violations[0].policyName).toBe('no-debugger');
  });

  it('member-bound key ignores a client-supplied roleName', async () => {
    // 'backend' is the only real role; a bogus roleName must not 404 or
    // select a different policy set — the member binding wins.
    const res = await request(app)
      .post(`/v1/orgs/${orgId}/check`)
      .set('x-api-key', devKey)
      .send({ type: 'code', content: 'debugger;', roleName: 'ghost-role' });
    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(false);
  });

  it('member-bound checks are attributed to the developer in the audit trail', async () => {
    const res = await request(app)
      .get(`/v1/orgs/${orgId}/audit?action=policy.checked`)
      .set('Authorization', `Bearer ${adminToken}`);
    const attributed = res.body.data.find((l: any) => l.actorId === devUserId);
    expect(attributed).toBeDefined();
  });

  it('org-wide key without roleName -> 400', async () => {
    const res = await request(app)
      .post(`/v1/orgs/${orgId}/check`)
      .set('x-api-key', orgKey)
      .send({ type: 'code', content: 'const a = 1;' });
    expect(res.status).toBe(400);
  });

  it('memberId from another org is rejected on key creation', async () => {
    const res = await request(app)
      .post(`/v1/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bad Key', memberId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
  });

  describe('deactivation', () => {
    it('deactivating a member kills their bound key; reactivating restores it', async () => {
      const off = await request(app)
        .patch(`/v1/orgs/${orgId}/members/${devUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false });
      expect(off.status).toBe(200);
      expect(off.body.membership.active).toBe(false);

      const blocked = await request(app)
        .post(`/v1/orgs/${orgId}/check`)
        .set('x-api-key', devKey)
        .send({ type: 'code', content: 'debugger;' });
      expect(blocked.status).toBe(401);

      const on = await request(app)
        .patch(`/v1/orgs/${orgId}/members/${devUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: true });
      expect(on.status).toBe(200);

      const works = await request(app)
        .post(`/v1/orgs/${orgId}/check`)
        .set('x-api-key', devKey)
        .send({ type: 'code', content: 'debugger;' });
      expect(works.status).toBe(200);
    });

    it('an admin cannot deactivate themselves', async () => {
      const me = await request(app).get('/v1/auth/me').set('Authorization', `Bearer ${adminToken}`);
      const res = await request(app)
        .patch(`/v1/orgs/${orgId}/members/${me.body.user.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false });
      expect(res.status).toBe(409);
    });

    it('deactivation and reactivation are audit-logged', async () => {
      const res = await request(app)
        .get(`/v1/orgs/${orgId}/audit?action=member.deactivated`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('policy packs', () => {
    it('lists available packs', async () => {
      const res = await request(app)
        .get('/v1/policy-packs')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.packs.map((p: any) => p.id).sort();
      expect(ids).toEqual(['baseline-security', 'dpdp', 'hipaa', 'pci-dss']);
    });

    it('imports a pack as SHADOW and skips collisions on re-import', async () => {
      const first = await request(app)
        .post(`/v1/orgs/${orgId}/policies/import-pack`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ packId: 'baseline-security' });
      expect(first.status).toBe(200);
      expect(first.body.imported.length).toBeGreaterThan(0);
      expect(first.body.status).toBe('SHADOW');

      const policies = await request(app)
        .get(`/v1/orgs/${orgId}/policies`)
        .set('Authorization', `Bearer ${adminToken}`);
      const imported = policies.body.policies.find((p: any) => p.name === 'no-private-key-material');
      expect(imported.status).toBe('SHADOW');

      const again = await request(app)
        .post(`/v1/orgs/${orgId}/policies/import-pack`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ packId: 'baseline-security' });
      expect(again.status).toBe(200);
      expect(again.body.imported).toEqual([]);
      expect(again.body.skipped.length).toBe(first.body.imported.length);
    });

    it('unknown pack -> 404', async () => {
      const res = await request(app)
        .post(`/v1/orgs/${orgId}/policies/import-pack`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ packId: 'no-such-pack' });
      expect(res.status).toBe(404);
    });
  });
});
