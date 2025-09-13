const path = require('path');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

const runtime = {
  dataStore: process.env.DATA_STORE || 'json',
  mode: process.env.MODE || 'basic',
  geocoder: process.env.GEOCODER || 'nominatim'
};

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

