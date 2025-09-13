const crypto = require('crypto');
const redis = require('redis');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const config = require('../config');

const REDIS_URL = config.REDIS_URL || 'redis://localhost:6379';
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

let redisClient;
async function getClient() {
  if (redisClient) return redisClient;
  try {
    redisClient = redis.createClient({ url: REDIS_URL });
    redisClient.on('error', (err) => {
      console.warn('Redis error', err.message);
    });
    await redisClient.connect();
  } catch (err) {
    console.warn('Redis connection failed', err.message);
    redisClient = null;
  }
  return redisClient;
}

async function geocode(address) {
  const hash = crypto.createHash('sha1').update(address.toLowerCase()).digest('hex');
  const cacheKey = `GEOCODE:addr:${hash}`;

  try {
    const client = await getClient();
    if (client) {
      const cached = await client.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    const headers = {};
    if (config.NOMINATIM_UA) headers['User-Agent'] = config.NOMINATIM_UA;
    if (config.NOMINATIM_EMAIL) headers['email'] = config.NOMINATIM_EMAIL;

    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    let attempt = 0;
    let lastErr;
    while (attempt < 3) {
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const result = data[0];
        if (!result) return null;
        const coordinates = {
          lat: parseFloat(result.lat),
          lng: parseFloat(result.lon),
          city: result.address?.city || result.address?.town || result.address?.village,
          country: result.address?.country,
          display_name: result.display_name
        };
        if (client) {
          await client.set(cacheKey, JSON.stringify(coordinates), { EX: TTL_SECONDS });
        }
        return coordinates;
      } catch (err) {
        lastErr = err;
        attempt += 1;
        if (attempt >= 3) break;
        const delay = 500 * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastErr;
  } catch (err) {
    throw err;
  }
}

module.exports = geocode;
