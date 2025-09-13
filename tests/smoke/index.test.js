const request = require('supertest');
const app = require('../../src/app');

describe('Smoke: index page', () => {
  it('serves the index.html file', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });
});
