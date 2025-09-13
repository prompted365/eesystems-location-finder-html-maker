const haversine = require('../../src/lib/haversine');

describe('haversine', () => {
  it('calculates distance between Los Angeles and New York', () => {
    const distance = haversine(34.0522, -118.2437, 40.7128, -74.0060);
    expect(distance).toBeCloseTo(2445.7, 1);
  });

  it('returns zero for identical coordinates', () => {
    expect(haversine(0, 0, 0, 0)).toBeCloseTo(0, 5);
  });
});
