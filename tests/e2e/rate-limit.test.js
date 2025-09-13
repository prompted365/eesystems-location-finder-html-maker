process.env.RATE_LIMIT_MAX = 2;

const { expectRateLimitExceeded } = require('./helpers/rateLimit');

describe('E2E: rate limiting', () => {
  it('limits /search requests', async () => {
    await expectRateLimitExceeded('/search');
  });

  it('limits /api/locations/geocode requests', async () => {
    await expectRateLimitExceeded('/api/locations/geocode', {
      method: 'post',
      payload: { address: '1600 Pennsylvania Ave' }
    });
  });

  it('limits /upload requests', async () => {
    await expectRateLimitExceeded('/upload', { method: 'post' });
  });
});
