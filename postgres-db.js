const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

class DatabaseManager {
  constructor() {
    this.pool = null;
    this.useLocalDB = process.env.USE_LOCAL_DB === 'true' || !process.env.DATABASE_URL;
    this.dbPath = path.join(__dirname, 'data', 'locations.json');
  }

  async connect() {
    if (this.useLocalDB) {
      console.log('📁 Using local JSON database');
      return;
    }

    try {
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });

      // Test the connection
      const client = await this.pool.connect();
      console.log('✅ Connected to PostgreSQL');
      
      // Create the locations table if it doesn't exist
      await this.createTable(client);
      
      client.release();
      
      // Check if we need to migrate data from local file to PostgreSQL
      await this.migrateDataIfNeeded();
      
    } catch (error) {
      console.error('Failed to connect to PostgreSQL:', error);
      console.log('📁 Falling back to local JSON database');
      this.useLocalDB = true;
    }
  }

  async createTable(client) {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS locations (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address TEXT,
        clean_address TEXT,
        original_address TEXT,
        latitude VARCHAR(50),
        longitude VARCHAR(50),
        booking_url TEXT,
        google_maps_link TEXT,
        data_quality VARCHAR(50),
        issues JSONB DEFAULT '[]',
        processed TIMESTAMP,
        country VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    await client.query(createTableQuery);
    console.log('📊 PostgreSQL table ready');
  }

  async migrateDataIfNeeded() {
    if (this.useLocalDB) return;

    try {
      const client = await this.pool.connect();
      
      // Check if PostgreSQL already has data
      const result = await client.query('SELECT COUNT(*) FROM locations');
      const count = parseInt(result.rows[0].count);
      
      if (count > 0) {
        console.log(`📊 PostgreSQL database already contains ${count} locations`);
        client.release();
        return;
      }

      // Check if local file exists and migrate it
      try {
        const localData = await fs.readFile(this.dbPath, 'utf8');
        const database = JSON.parse(localData);
        
        if (database.locations && database.locations.length > 0) {
          console.log(`📈 Migrating ${database.locations.length} locations to PostgreSQL`);
          
          for (const location of database.locations) {
            await client.query(
              `INSERT INTO locations (
                id, name, address, clean_address, original_address, 
                latitude, longitude, booking_url, google_maps_link, 
                data_quality, issues, processed, country
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
              ON CONFLICT (id) DO NOTHING`,
              [
                location.id,
                location.name,
                [location.street, location.city, location.region, location.postal]
                  .filter(Boolean)
                  .join(', '),
                [location.street, location.city, location.region, location.postal]
                  .filter(Boolean)
                  .join(', '),
                [location.street, location.city, location.region, location.postal]
                  .filter(Boolean)
                  .join(', '),
                location.lat,
                location.lng,
                location.booking_url,
                location.map_url,
                'good',
                JSON.stringify([]),
                new Date(),
                location.country_code
              ]
            );
          }
          
          console.log('✅ Migration to PostgreSQL completed');
        }
      } catch (err) {
        console.log('📝 No local data to migrate, starting fresh');
      }
      
      client.release();
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
      // Use PostgreSQL
      try {
        const client = await this.pool.connect();
        const result = await client.query('SELECT * FROM locations ORDER BY created_at DESC');
        client.release();
        
        const locations = result.rows.map(row => ({
          id: row.id,
          name: row.name,
          address: row.address,
          cleanAddress: row.clean_address,
          originalAddress: row.original_address,
          latitude: row.latitude,
          longitude: row.longitude,
          bookingUrl: row.booking_url,
          googleMapsLink: row.google_maps_link,
          dataQuality: row.data_quality,
          issues: row.issues || [],
          processed: row.processed?.toISOString(),
          country: row.country
        }));

        return {
          locations,
          lastUpdated: new Date().toISOString(),
          version: '2.0'
        };
      } catch (error) {
        console.error('PostgreSQL read error:', error);
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
      // For PostgreSQL, we don't need to save the entire database
      // Individual operations handle their own saves
      console.log('💾 Database operations handled by PostgreSQL');
    }
  }

  async addLocation(location) {
    if (this.useLocalDB) {
      const db = await this.loadDatabase();
      db.locations.push(location);
      await this.saveDatabase(db);
      return location;
    } else {
      try {
        const client = await this.pool.connect();
        
        await client.query(
          `INSERT INTO locations (
            id, name, address, clean_address, original_address, 
            latitude, longitude, booking_url, google_maps_link, 
            data_quality, issues, processed, country
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            location.id,
            location.name,
            [location.street, location.city, location.region, location.postal]
              .filter(Boolean)
              .join(', '),
            [location.street, location.city, location.region, location.postal]
              .filter(Boolean)
              .join(', '),
            [location.street, location.city, location.region, location.postal]
              .filter(Boolean)
              .join(', '),
            location.lat,
            location.lng,
            location.booking_url,
            location.map_url,
            'good',
            JSON.stringify([]),
            new Date(),
            location.country_code
          ]
        );
        
        client.release();
        console.log(`✅ Added location: ${location.name}`);
        return location;
      } catch (error) {
        console.error('Error adding location:', error);
        throw error;
      }
    }
  }

  async updateLocation(name, updates) {
    if (this.useLocalDB) {
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
    } else {
      try {
        const client = await this.pool.connect();
        
        const result = await client.query(
          `UPDATE locations SET 
            address = COALESCE($2, address),
            clean_address = COALESCE($3, clean_address),
            latitude = COALESCE($4, latitude),
            longitude = COALESCE($5, longitude),
            booking_url = COALESCE($6, booking_url),
            country = COALESCE($7, country),
            updated_at = CURRENT_TIMESTAMP
          WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
          RETURNING *`,
          [
            name,
            updates.address,
            updates.cleanAddress || updates.address,
            updates.latitude,
            updates.longitude,
            updates.bookingUrl,
            updates.country
          ]
        );
        
        client.release();
        
        if (result.rows.length > 0) {
          console.log(`✅ Updated location: ${name}`);
          return result.rows[0];
        }
        return null;
      } catch (error) {
        console.error('Error updating location:', error);
        throw error;
      }
    }
  }

  async findLocationByName(name) {
    if (this.useLocalDB) {
      const db = await this.loadDatabase();
      return db.locations.find(
        loc => loc.name.toLowerCase().trim() === name.toLowerCase().trim()
      );
    } else {
      try {
        const client = await this.pool.connect();
        
        const result = await client.query(
          'SELECT * FROM locations WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1',
          [name]
        );
        
        client.release();
        
        if (result.rows.length > 0) {
          const row = result.rows[0];
          return {
            id: row.id,
            name: row.name,
            address: row.address,
            cleanAddress: row.clean_address,
            originalAddress: row.original_address,
            latitude: row.latitude,
            longitude: row.longitude,
            bookingUrl: row.booking_url,
            googleMapsLink: row.google_maps_link,
            dataQuality: row.data_quality,
            issues: row.issues || [],
            processed: row.processed?.toISOString(),
            country: row.country
          };
        }
        return null;
      } catch (error) {
        console.error('Error finding location:', error);
        throw error;
      }
    }
  }

  async getLocationsCount() {
    if (this.useLocalDB) {
      const db = await this.loadDatabase();
      return db.locations.length;
    } else {
      try {
        const client = await this.pool.connect();
        const result = await client.query('SELECT COUNT(*) FROM locations');
        client.release();
        return parseInt(result.rows[0].count);
      } catch (error) {
        console.error('Error getting locations count:', error);
        return 0;
      }
    }
  }

  async clearDatabase() {
    if (this.useLocalDB) {
      const emptyDb = {
        locations: [],
        lastUpdated: new Date().toISOString(),
        version: '2.0'
      };
      await this.saveDatabase(emptyDb);
      return emptyDb;
    } else {
      try {
        const client = await this.pool.connect();
        await client.query('DELETE FROM locations');
        client.release();
        console.log('🗑️ PostgreSQL database cleared');
        return {
          locations: [],
          lastUpdated: new Date().toISOString(),
          version: '2.0'
        };
      } catch (error) {
        console.error('Error clearing database:', error);
        throw error;
      }
    }
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      console.log('🔌 Disconnected from PostgreSQL');
    }
  }
}

module.exports = DatabaseManager;