const path = require('path');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

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
  console.warn(`Failed to load data store "${runtime.dataStore}": ${err.message}`);
}

app.get('/status', (req, res) => {
  res.json({ ok: true, runtime });
});

if (enableAdmin) {
  if (!adminToken) {
    console.warn('ENABLE_ADMIN is set but ADMIN_TOKEN is missing');
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

app.listen(port, async () => {
  console.log(`EESystem Location app running at http://localhost:${port}`);
  console.log(`DATA_STORE=${runtime.dataStore}`);
  console.log(`MODE=${runtime.mode}`);
  console.log(`GEOCODER=${runtime.geocoder}`);

  if (store && typeof store.connect === 'function') {
    try {
      await store.connect();
    } catch (err) {
      console.error('Failed to connect data store:', err.message);
    }
  }
});

