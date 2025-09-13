const request = require('supertest');

jest.mock('../../src/core/geocode');
const geocode = require('../../src/core/geocode');
const app = require('../../src/app');

describe('POST /api/locations/geocode', () => {
  const endpoint = '/api/locations/geocode';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns coordinates when geocode succeeds', async () => {
    const coords = { lat: 1, lng: 2 };
    geocode.mockResolvedValue(coords);
    const address = ' 123 Main St ';

    const res = await request(app)
      .post(endpoint)
      .send({ address });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, query: address.trim(), coordinates: coords });
    expect(geocode).toHaveBeenCalledWith(address.trim());
  });

  it('returns 404 when location not found', async () => {
    geocode.mockResolvedValue(null);

    const res = await request(app)
      .post(endpoint)
      .send({ address: 'Unknown' });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Location not found' });
  });

  it('returns 500 when geocode throws', async () => {
    geocode.mockRejectedValue(new Error('failure'));

    const res = await request(app)
      .post(endpoint)
      .send({ address: '123 Main St' });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to geocode address' });
  });

  it('returns 400 when address is missing', async () => {
    const res = await request(app)
      .post(endpoint)
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Address is required' });
    expect(geocode).not.toHaveBeenCalled();
  });
});
