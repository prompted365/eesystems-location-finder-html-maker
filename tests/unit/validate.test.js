const { validate, schemas } = require('../../src/lib/validate');

function createMockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
}

describe('validate middleware', () => {
  describe('search schema', () => {
    it('passes valid data and populates req.validated', () => {
      const req = { query: { q: 'energy', limit: '5' } };
      const res = createMockRes();
      const next = jest.fn();

      validate(schemas.search)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.validated).toEqual({ q: 'energy', limit: 5 });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 400 on invalid data', () => {
      const req = { query: { q: '' } };
      const res = createMockRes();
      const next = jest.fn();

      validate(schemas.search)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          details: expect.any(Object)
        })
      }));
      expect(next).not.toHaveBeenCalled();
      expect(req.validated).toBeUndefined();
    });
  });

  describe('nearest schema', () => {
    it('passes valid coordinates', () => {
      const req = { query: { lat: '34.0522', lng: '-118.2437', limit: '2' } };
      const res = createMockRes();
      const next = jest.fn();

      validate(schemas.nearest)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.validated).toEqual({ lat: 34.0522, lng: -118.2437, limit: 2 });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 400 on invalid coordinates', () => {
      const req = { query: { lat: 'abc', lng: '-118.2437' } };
      const res = createMockRes();
      const next = jest.fn();

      validate(schemas.nearest)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          details: expect.any(Object)
        })
      }));
      expect(next).not.toHaveBeenCalled();
      expect(req.validated).toBeUndefined();
    });
  });

  describe('byLocation schema', () => {
    it('passes valid location', () => {
      const req = { query: { country: 'USA', city: 'Los Angeles' } };
      const res = createMockRes();
      const next = jest.fn();

      validate(schemas.byLocation)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.validated).toEqual({ country: 'USA', city: 'Los Angeles' });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 400 when country missing', () => {
      const req = { query: { city: 'Los Angeles' } };
      const res = createMockRes();
      const next = jest.fn();

      validate(schemas.byLocation)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          details: expect.any(Object)
        })
      }));
      expect(next).not.toHaveBeenCalled();
      expect(req.validated).toBeUndefined();
    });
  });
});

