const path = require('path');
const express = require('express');
const pino = require('pino');
const pinoHttp = require('pino-http');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { validate, schemas } = require('./lib/validate');
const geocode = require('./core/geocode');

const app = express();
const port = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const logger = pino({
  level: isProd ? 'info' : 'debug'
});

app.use(pinoHttp({ logger }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ['https://eesystem.com', 'https://*.eesystem.com'] }));
app.use(compression());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100
});
app.use('/search', limiter);
app.use('/api/locations/geocode', limiter);
app.use('/upload', limiter);

const runtime = {
  dataStore: process.env.DATA_STORE || 'json',
  mode: process.env.MODE || 'basic',
  geocoder: process.env.GEOCODER || 'nominatim'
};

const enableAdmin = process.env.ENABLE_ADMIN === 'true';
const adminToken = process.env.ADMIN_TOKEN;

let store;
try {
  switch (runtime.dataStore.toLowerCase()) {
    case 'postgres':
      const PgStore = require('../postgres-db');
      store = new PgStore();
      break;
    case 'redis':
      const RedisStore = require('../redis-db');
      store = new RedisStore();
      break;
    default:
      store = require('../database.json');
  }
} catch (err) {
  logger.warn(`Failed to load data store "${runtime.dataStore}": ${err.message}`);
}

app.get('/status', (req, res) => {
  res.json({ ok: true, data: runtime, meta: null });
});

function formatLocation(location) {
  return {
    id: location.id,
    name: location.name,
    address: location.address,
    bookingUrl: location.bookingUrl,
    googleMapsLink: location.googleMapsLink,
    latitude: parseFloat(location.latitude),
    longitude: parseFloat(location.longitude),
    country: location.country
  };
}

function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

app.get('/api/locations/search', validate(schemas.search), (req, res) => {
  const { q, limit } = req.validated;
  const query = q.toLowerCase();
  const locations = (store?.locations || [])
    .filter(loc => {
      const name = (loc.name || '').toLowerCase();
      const address = (loc.address || '').toLowerCase();
      const country = (loc.country || '').toLowerCase();
      return name.includes(query) || address.includes(query) || country.includes(query);
    })
    .slice(0, limit)
    .map(formatLocation);
  res.json({ ok: true, data: locations, meta: { total: locations.length, query: q } });
});

app.get('/api/locations/nearest', validate(schemas.nearest), (req, res) => {
  const { lat, lng, limit } = req.validated;
  const results = (store?.locations || [])
    .filter(loc => loc.latitude && loc.longitude)
    .map(loc => {
      const distance = calculateDistance(lat, lng, parseFloat(loc.latitude), parseFloat(loc.longitude));
      return { ...formatLocation(loc), distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
  res.json({ ok: true, data: results, meta: { total: results.length, userLocation: { lat, lng } } });
});

app.get('/api/locations/by-location', validate(schemas.byLocation), (req, res) => {
  const { country, city } = req.validated;
  let results = (store?.locations || []).filter(loc => (loc.country || '').toLowerCase() === country.toLowerCase());
  if (city) {
    results = results.filter(loc => (loc.address || '').toLowerCase().includes(city.toLowerCase()));
  }
  results = results.map(formatLocation);
  res.json({ ok: true, data: results, meta: { total: results.length, filters: { country, city } } });
});

app.post('/api/locations/geocode', async (req, res) => {
  const { address } = req.body || {};
  if (!address || !address.trim()) {
    return res.status(400).json({ success: false, error: 'Address is required' });
  }
  try {
    const coordinates = await geocode(address.trim());
    if (!coordinates) {
      return res.status(404).json({ success: false, error: 'Location not found' });
    }
    res.json({ success: true, query: address.trim(), coordinates });
  } catch (err) {
    logger.error('Geocoding failed', err);
    res.status(500).json({ success: false, error: 'Failed to geocode address' });
  }
});

if (enableAdmin) {
  if (!adminToken) {
    logger.warn('ENABLE_ADMIN is set but ADMIN_TOKEN is missing');
  }
  const adminAuth = (req, res, next) => {
    const token = req.query.token || req.headers['x-admin-token'];
    if (adminToken && token === adminToken) {
      return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
  };

  app.get('/admin', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'deprecated', 'public', 'admin.html'));
  });

  app.get('/ai-interface', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'deprecated', 'public', 'ai-interface.html'));
  });
}

app.use(express.static(path.join(__dirname, '..', 'public')));

if (require.main === module) {
  app.listen(port, async () => {
    if (!isProd) {
      logger.info(`EESystem Location app running at http://localhost:${port}`);
      logger.info(`DATA_STORE=${runtime.dataStore}`);
      logger.info(`MODE=${runtime.mode}`);
      logger.info(`GEOCODER=${runtime.geocoder}`);
    }

    if (store && typeof store.connect === 'function') {
      try {
        await store.connect();
      } catch (err) {
        logger.error('Failed to connect data store:', err.message);
      }
    }
  });
}

module.exports = app;

