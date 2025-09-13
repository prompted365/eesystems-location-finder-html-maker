const redis = require('redis');
const fs = require('fs').promises;
const path = require('path');

class DatabaseManager {
  constructor() {
    this.client = null;
    this.useLocalDB = process.env.USE_LOCAL_DB === 'true' || !process.env.REDIS_URL;
    this.dbPath = path.join(__dirname, 'data', 'locations.json');
  }

  async connect() {
    if (this.useLocalDB) {
      console.log('📁 Using local JSON database');
      return;
    }

    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      this.client = redis.createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error('❌ Too many Redis reconnection attempts');
              return new Error('Too many reconnection attempts');
            }
            return Math.min(retries * 100, 3000);
          }
        }
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
        console.log('Falling back to local database...');
        this.useLocalDB = true;
      });

      this.client.on('connect', () => {
        console.log('🔗 Connected to Redis');
      });

      await this.client.connect();
      console.log('✅ Redis connection established');
      
      // Check if we need to migrate data from local file to Redis
      await this.migrateDataIfNeeded();
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      console.log('📁 Falling back to local JSON database');
      this.useLocalDB = true;
    }
  }

  async migrateDataIfNeeded() {
    if (this.useLocalDB) return;

    try {
      // Check if Redis already has data
      const existingData = await this.client.get('ee-locations-db');
      if (existingData) {
        console.log('📊 Redis database already contains data');
        return;
      }

      // Check if local file exists and migrate it
      try {
        const localData = await fs.readFile(this.dbPath, 'utf8');
        const database = JSON.parse(localData);
        await this.client.set('ee-locations-db', JSON.stringify(database));
        console.log('✅ Migrated local database to Redis');
      } catch (err) {
        // No local file to migrate
        console.log('📝 Initializing new Redis database');
        const initialData = {
          locations: [],
          lastUpdated: new Date().toISOString(),
          version: '2.0'
        };
        await this.client.set('ee-locations-db', JSON.stringify(initialData));
      }
    } catch (error) {
      console.error('Migration error:', error);
    }
  }

  async loadDatabase() {
    if (this.useLocalDB) {
      // Use local JSON file
      try {
        const data = await fs.readFile(this.dbPath, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist, return empty database
          const emptyDb = {
            locations: [],
            lastUpdated: new Date().toISOString(),
            version: '2.0'
          };
          await this.saveDatabase(emptyDb);
          return emptyDb;
        }
        throw error;
      }
    } else {
      // Use Redis
      try {
        const data = await this.client.get('ee-locations-db');
        if (!data) {
          const emptyDb = {
            locations: [],
            lastUpdated: new Date().toISOString(),
            version: '2.0'
          };
          await this.saveDatabase(emptyDb);
          return emptyDb;
        }
        return JSON.parse(data);
      } catch (error) {
        console.error('Redis read error:', error);
        throw error;
      }
    }
  }

  async saveDatabase(database) {
    database.lastUpdated = new Date().toISOString();
    
    if (this.useLocalDB) {
      // Save to local JSON file
      await fs.writeFile(this.dbPath, JSON.stringify(database, null, 2));
      console.log('💾 Database saved to local file');
    } else {
      // Save to Redis
      try {
        await this.client.set('ee-locations-db', JSON.stringify(database));
        // Set expiration to 30 days (optional, remove if you want permanent storage)
        // await this.client.expire('ee-locations-db', 60 * 60 * 24 * 30);
        console.log('💾 Database saved to Redis');
      } catch (error) {
        console.error('Redis write error:', error);
        // Fallback to local file
        await fs.writeFile(this.dbPath, JSON.stringify(database, null, 2));
        console.log('💾 Fallback: Database saved to local file');
      }
    }
  }

  async disconnect() {
    if (this.client && this.client.isOpen) {
      await this.client.disconnect();
      console.log('🔌 Disconnected from Redis');
    }
  }

  // Additional utility methods
  async getLocationsCount() {
    const db = await this.loadDatabase();
    return db.locations.length;
  }

  async addLocation(location) {
    const db = await this.loadDatabase();
    db.locations.push(location);
    await this.saveDatabase(db);
    return location;
  }

  async updateLocation(name, updates) {
    const db = await this.loadDatabase();
    const index = db.locations.findIndex(
      loc => loc.name.toLowerCase().trim() === name.toLowerCase().trim()
    );
    if (index !== -1) {
      db.locations[index] = { ...db.locations[index], ...updates };
      await this.saveDatabase(db);
      return db.locations[index];
    }
    return null;
  }

  async findLocationByName(name) {
    const db = await this.loadDatabase();
    return db.locations.find(
      loc => loc.name.toLowerCase().trim() === name.toLowerCase().trim()
    );
  }

  async clearDatabase() {
    const emptyDb = {
      locations: [],
      lastUpdated: new Date().toISOString(),
      version: '2.0'
    };
    await this.saveDatabase(emptyDb);
    return emptyDb;
  }
}

module.exports = DatabaseManager;