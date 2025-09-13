jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

const fetchMock = jest.fn();

describe('geocode', () => {
  let geocode;
  let redis;

  const load = async () => {
    redis = require('redis');
    await jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));
    geocode = (await import('../../src/core/geocode')).default;
  };

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    fetchMock.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.NOMINATIM_UA;
    delete process.env.NOMINATIM_EMAIL;
  });

  it('returns cached coordinates when present', async () => {
    await load();
    const cached = { lat: 1, lng: 2 };
    const mockClient = {
      connect: jest.fn().mockResolvedValue(),
      on: jest.fn(),
      get: jest.fn().mockResolvedValue(JSON.stringify(cached)),
      set: jest.fn(),
    };
    redis.createClient.mockReturnValue(mockClient);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await geocode('123 Main St');
    await geocode('456 Other St'); // reuse existing redis client

    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual(cached);

    // trigger error handler for coverage
    const errHandler = mockClient.on.mock.calls[0][1];
    errHandler(new Error('boom'));

    warnSpy.mockRestore();
  });

  it('fetches and caches coordinates when not cached and sets headers', async () => {
    process.env.NOMINATIM_UA = 'agent';
    process.env.NOMINATIM_EMAIL = 'agent@example.com';
    await load();
    const mockClient = {
      connect: jest.fn().mockResolvedValue(),
      on: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(),
    };
    redis.createClient.mockReturnValue(mockClient);
    const apiResponse = [
      {
        lat: '1',
        lon: '2',
        address: { city: 'City', country: 'Country' },
        display_name: 'City, Country',
      },
    ];
    fetchMock.mockResolvedValue({ ok: true, json: async () => apiResponse });

    const result = await geocode('123 Main St');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      { headers: { 'User-Agent': 'agent', email: 'agent@example.com' } }
    );
    expect(mockClient.set).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(result),
      { EX: 60 * 60 * 24 * 30 }
    );
    expect(result).toEqual({
      lat: 1,
      lng: 2,
      city: 'City',
      country: 'Country',
      display_name: 'City, Country',
    });
  });

  it('returns null when API returns no results', async () => {
    await load();
    const mockClient = {
      connect: jest.fn().mockResolvedValue(),
      on: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
    };
    redis.createClient.mockReturnValue(mockClient);
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });

    const result = await geocode('Unknown');

    expect(result).toBeNull();
    expect(mockClient.set).not.toHaveBeenCalled();
  });

  it('uses town when city is missing', async () => {
    await load();
    const mockClient = {
      connect: jest.fn().mockResolvedValue(),
      on: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
    };
    redis.createClient.mockReturnValue(mockClient);
    const apiResponse = [{ lat: '1', lon: '2', address: { town: 'Town' }, display_name: 'Town' }];
    fetchMock.mockResolvedValue({ ok: true, json: async () => apiResponse });

    const result = await geocode('Addr');

    expect(result.city).toBe('Town');
  });

  it('uses village when city and town are missing', async () => {
    await load();
    const mockClient = {
      connect: jest.fn().mockResolvedValue(),
      on: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
    };
    redis.createClient.mockReturnValue(mockClient);
    const apiResponse = [{ lat: '1', lon: '2', address: { village: 'Village' }, display_name: 'Village' }];
    fetchMock.mockResolvedValue({ ok: true, json: async () => apiResponse });

    const result = await geocode('Addr2');

    expect(result.city).toBe('Village');
  });

  it('handles missing locality fields', async () => {
    await load();
    const mockClient = {
      connect: jest.fn().mockResolvedValue(),
      on: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
    };
    redis.createClient.mockReturnValue(mockClient);
    const apiResponse = [{ lat: '1', lon: '2', address: {}, display_name: 'Nowhere' }];
    fetchMock.mockResolvedValue({ ok: true, json: async () => apiResponse });

    const result = await geocode('Addr3');

    expect(result.city).toBeUndefined();
  });

  it('fetches successfully when redis is unavailable', async () => {
    await load();
    const mockClient = {
      connect: jest.fn().mockRejectedValue(new Error('connect fail')),
      on: jest.fn(),
    };
    redis.createClient.mockReturnValue(mockClient);
    const apiResponse = [{ lat: '1', lon: '2', address: { city: 'City', country: 'Country' }, display_name: 'City' }];
    fetchMock.mockResolvedValue({ ok: true, json: async () => apiResponse });

    const result = await geocode('Addr4');

    expect(result).toEqual({ lat: 1, lng: 2, city: 'City', country: 'Country', display_name: 'City' });
  });

  it('retries on fetch failure with exponential backoff', async () => {
    await load();
    const mockClient = {
      connect: jest.fn().mockRejectedValue(new Error('connect fail')),
      on: jest.fn(),
    };
    redis.createClient.mockReturnValue(mockClient);
    const err = new Error('network');
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockRejectedValue(err);

    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(geocode('123 Main St')).rejects.toThrow('network');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(timeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 500);
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 1000);

    timeoutSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
