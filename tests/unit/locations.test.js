const request = require('supertest');
const app = require('../../src/app');

describe('GET /api/locations/search', () => {
  it('validates query params', async () => {
    const res = await request(app).get('/api/locations/search');
    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns results', async () => {
    const res = await request(app).get('/api/locations/search?q=tex');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('meta');
  });
});

describe('GET /api/locations/nearest', () => {
  it('validates required params', async () => {
    const res = await request(app).get('/api/locations/nearest');
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns nearest locations', async () => {
    const res = await request(app).get('/api/locations/nearest?lat=33.4554566&lng=-94.06533436&limit=1');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

describe('GET /api/locations/by-location', () => {
  it('requires country', async () => {
    const res = await request(app).get('/api/locations/by-location');
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('filters by country and city', async () => {
    const res = await request(app).get('/api/locations/by-location?country=United%20States&city=Las%20Vegas');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
