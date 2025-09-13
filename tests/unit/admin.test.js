const request = require('supertest');

const ADMIN_TOKEN = 'test-token';

let app;

describe('admin routes', () => {
  beforeAll(() => {
    process.env.ENABLE_ADMIN = 'true';
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    jest.resetModules();
    app = require('../../src/app');
  });

  it('rejects unauthorized access', async () => {
    const res = await request(app).get('/admin');
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('serves admin.html with valid query token', async () => {
    const res = await request(app).get('/admin').query({ token: ADMIN_TOKEN });
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('EESystem Admin Testing Dashboard');
  });

  it('serves ai-interface.html with valid header token', async () => {
    const res = await request(app)
      .get('/ai-interface')
      .set('x-admin-token', ADMIN_TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('AI-Powered EESystem Location Manager');
  });
});

describe('admin config', () => {
  it('loads when ADMIN_TOKEN is missing', () => {
    delete process.env.ADMIN_TOKEN;
    process.env.ENABLE_ADMIN = 'true';
    jest.resetModules();
    require('../../src/app');
  });
});

