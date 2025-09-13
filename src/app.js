const path = require('path');
const express = require('express');
const pino = require('pino');
const pinoHttp = require('pino-http');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

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

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100
});
app.use('/search', limiter);
app.use('/geocode', limiter);
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
  res.json({ ok: true, runtime });
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

