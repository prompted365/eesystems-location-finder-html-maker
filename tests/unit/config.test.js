const { ZodError } = require('zod');

const loadConfig = () => {
  jest.resetModules();
  return require('../../src/config');
};

describe('config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses defaults when env vars are absent', () => {
    delete process.env.PORT;
    delete process.env.NODE_ENV;
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.DATA_STORE;
    delete process.env.MODE;
    delete process.env.GEOCODER;
    delete process.env.ENABLE_ADMIN;
    delete process.env.ADMIN_TOKEN;
    delete process.env.USE_LOCAL_DB;
    delete process.env.REDIS_URL;
    delete process.env.NOMINATIM_UA;
    delete process.env.NOMINATIM_EMAIL;
    delete process.env.DATABASE_URL;

    const config = loadConfig();

    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.RATE_LIMIT_MAX).toBe(100);
    expect(config.DATA_STORE).toBe('json');
    expect(config.MODE).toBe('basic');
    expect(config.GEOCODER).toBe('nominatim');
    expect(config.ENABLE_ADMIN).toBe(false);
    expect(config.USE_LOCAL_DB).toBe(false);
    expect(config.ADMIN_TOKEN).toBeUndefined();
    expect(config.REDIS_URL).toBeUndefined();
  });

  it('coerces numeric and boolean env vars', () => {
    process.env.PORT = '4000';
    process.env.RATE_LIMIT_MAX = '200';
    process.env.ENABLE_ADMIN = 'true';
    process.env.USE_LOCAL_DB = 'true';

    const config = loadConfig();

    expect(config.PORT).toBe(4000);
    expect(config.RATE_LIMIT_MAX).toBe(200);
    expect(config.ENABLE_ADMIN).toBe(true);
    expect(config.USE_LOCAL_DB).toBe(true);
  });

  it('supports optional variables when provided', () => {
    process.env.ADMIN_TOKEN = 'secret';
    process.env.REDIS_URL = 'redis://localhost:6379';

    const config = loadConfig();

    expect(config.ADMIN_TOKEN).toBe('secret');
    expect(config.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('throws when numeric env vars are invalid', () => {
    process.env.PORT = 'not-a-number';

    try {
      loadConfig();
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.name).toBe('ZodError');
    }
  });
});
