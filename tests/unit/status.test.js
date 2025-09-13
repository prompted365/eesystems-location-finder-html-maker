const request = require('supertest');
const app = require('../../src/app');

describe('GET /status', () => {
  it('returns ok true', async () => {
    const res = await request(app).get('/status');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
