const request = require('supertest');
const app = require('../../../src/app');

function makeRequest(method, endpoint, payload) {
  let req = request(app)[method](endpoint);
  if (payload) {
    req = req.send(payload);
  }
  return req;
}

async function expectRateLimitExceeded(endpoint, { method = 'get', payload } = {}) {
  const max = Number(process.env.RATE_LIMIT_MAX) || 2;
  for (let i = 0; i < max; i++) {
    await makeRequest(method, endpoint, payload);
  }
  const res = await makeRequest(method, endpoint, payload);
  expect(res.status).toBe(429);
}

module.exports = { expectRateLimitExceeded };
