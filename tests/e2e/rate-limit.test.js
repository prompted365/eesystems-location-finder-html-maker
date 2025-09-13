process.env.RATE_LIMIT_MAX = 2;
const request = require('supertest');
const app = require('../../src/app');

describe('E2E: rate limiting', () => {
  it('returns 429 after exceeding limit', async () => {
    await request(app).get('/search');
    await request(app).get('/search');
    const res = await request(app).get('/search');
    expect(res.status).toBe(429);
  });
});
