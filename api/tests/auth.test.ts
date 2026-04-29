import request from 'supertest';
import app from '../src/index';

describe('Auth Routes', () => {
  let token: string;
  const mockUser = {
    email: 'test@example.com',
    password: 'password123',
    firstName: 'Test',
    lastName: 'User',
    orgName: 'Test Org',
    orgSlug: 'test-org'
  };

  it('POST /v1/auth/signup -> 201', async () => {
    const res = await request(app).post('/v1/auth/signup').send(mockUser);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toHaveProperty('email', mockUser.email);
    token = res.body.token;
  });

  it('POST /v1/auth/signup with duplicate email -> 409', async () => {
    const res = await request(app)
      .post('/v1/auth/signup')
      .send({ ...mockUser, orgSlug: 'another-org' });
    expect(res.status).toBe(409);
  });

  it('POST /v1/auth/signup with duplicate slug -> 409', async () => {
    const res = await request(app)
      .post('/v1/auth/signup')
      .send({ ...mockUser, email: 'another@example.com' });
    expect(res.status).toBe(409);
  });

  it('POST /v1/auth/login with correct credentials -> 200', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: mockUser.email, password: mockUser.password });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  it('POST /v1/auth/login with wrong password -> 401', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: mockUser.email, password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('GET /v1/auth/me with valid token -> 200', async () => {
    const res = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toHaveProperty('email', mockUser.email);
  });

  it('GET /v1/auth/me without token -> 401', async () => {
    const res = await request(app).get('/v1/auth/me');
    expect(res.status).toBe(401);
  });
});
