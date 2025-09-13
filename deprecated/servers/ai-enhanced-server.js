require('dotenv').config();
const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const validator = require('validator');
const rateLimit = require('express-rate-limit');
const DatabaseManager = require('./postgres-db');

const app = express();
const port = process.env.PORT || 3001;

const enableAdmin = process.env.ENABLE_ADMIN === 'true';
const adminToken = process.env.ADMIN_TOKEN;

// Initialize database manager
const dbManager = new DatabaseManager();

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many requests from this IP, please try again later.'
});

app.use(limiter);
// Serve static files
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

// Redirect root to location finder
app.get('/', (req, res) => {
  res.redirect('/finder');
});

// Serve the location finder page
app.get('/finder', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'finder.html'));
});

// Admin interface for testing and validation
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
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
  });
}
app.use(express.json());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed!'), false);
    }
  }
});

// Database file path
const DB_PATH = path.join(__dirname, 'locations_db.json');

// Helper functions
function sanitizeString(str) {
  if (!str) return '';
  return String(str).replace(/[<>"'&]/g, function(match) {
    const escapeMap = {
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '&': '&amp;'
    };
    return escapeMap[match];
  });
}

function validateUrl(url) {
  if (!url) return false;
  const cleanUrl = url.trim();
  if (!/^https?:\/\//i.test(cleanUrl)) {
    return validator.isURL('https://' + cleanUrl.replace(/^\/+/, ''));
  }
  return validator.isURL(cleanUrl);
}

function ensureHttps(url) {
  if (!url) return '';
  const cleanUrl = url.trim();
  if (!/^https?:\/\//i.test(cleanUrl)) {
    return 'https://' + cleanUrl.replace(/^\/+/, '');
  }
  return cleanUrl;
}

// Database functions (now using DatabaseManager)
async function loadDatabase() {
  return await dbManager.loadDatabase();
}

async function saveDatabase(database) {
  return await dbManager.saveDatabase(database);
}

// Parse CSV data
function processCsvData(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    let rowCount = 0;

    fsSync.createReadStream(filePath)
      .pipe(csv({ skipEmptyLines: true }))
      .on('data', (data) => {
        rowCount++;
        
        // Map CSV columns to our expected format
        const csvData = {
          name: data['name'] || data['Business Name'],
          address: data['address'] || data['Address'],
          bookingUrl: data['bookingUrl'] || data['Booking URL'],
          lat: parseFloat(data['lat']) || null,
          lng: parseFloat(data['lng']) || null,
          country: data['country'] || '',
          googlemaps: data['googlemaps'] || data['Google Maps Link']
        };

        // Skip header rows
        if (rowCount === 1 && (
          csvData.name?.toLowerCase().includes('name') || 
          csvData.name?.toLowerCase().includes('business')
        )) {
          return;
        }

        // Validate required fields - be more lenient
        if (!csvData.name || !csvData.name.trim()) {
          errors.push(`Row ${rowCount}: Missing center name`);
          return;
        }
        
        if (!csvData.address || !csvData.address.trim()) {
          errors.push(`Row ${rowCount}: Missing address for "${csvData.name}"`);
          return;
        }
        
        if (!csvData.bookingUrl || !csvData.bookingUrl.trim()) {
          errors.push(`Row ${rowCount}: Missing booking URL for "${csvData.name}"`);
          return;
        }

        // Validate booking URL - be more lenient and fix common issues
        const bookingUrlToTest = csvData.bookingUrl.trim();
        let isValidUrl = false;
        
        try {
          // Try with original URL
          if (validateUrl(bookingUrlToTest)) {
            isValidUrl = true;
          } else if (bookingUrlToTest.includes('ee-system.com')) {
            // If it contains ee-system.com, likely valid but missing https://
            isValidUrl = true;
          } else if (bookingUrlToTest.startsWith('www.')) {
            // Try with https prefix
            isValidUrl = validateUrl('https://' + bookingUrlToTest);
          }
        } catch (e) {
          // If validation throws error, still allow if it looks like an EE-System URL
          if (bookingUrlToTest.includes('ee-system.com')) {
            isValidUrl = true;
          }
        }
        
        if (!isValidUrl) {
          errors.push(`Row ${rowCount}: Invalid booking URL format for "${csvData.name}": "${csvData.bookingUrl}"`);
          return;
        }

        // Clean and format the data
        const cleanData = {
          name: sanitizeString(csvData.name.trim()),
          address: sanitizeString(csvData.address.trim()),
          bookingUrl: ensureHttps(csvData.bookingUrl.trim()),
          lat: csvData.lat,
          lng: csvData.lng,
          country: csvData.country.trim(),
          googlemaps: csvData.googlemaps ? csvData.googlemaps.trim() : ''
        };

        results.push(cleanData);
      })
      .on('end', () => {
        if (errors.length > 0) {
          reject(new Error(errors.join('\n')));
        } else if (results.length === 0) {
          reject(new Error('No valid data found in CSV file'));
        } else {
          resolve(results);
        }
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

// Compare CSV with database and identify differences
function compareWithDatabase(csvData, dbData) {
  const differences = {
    new: [],
    updated: [],
    unchanged: []
  };

  // Create a map of existing locations by name for quick lookup
  const existingMap = new Map();
  dbData.locations.forEach(loc => {
    existingMap.set(loc.name.toLowerCase().trim(), loc);
  });

  csvData.forEach(csvItem => {
    const nameKey = csvItem.name.toLowerCase().trim();
    const existing = existingMap.get(nameKey);

    if (!existing) {
      // New location
      differences.new.push(csvItem);
    } else {
      // Check for updates
      const existingLat = parseFloat(existing.latitude) || 0;
      const existingLng = parseFloat(existing.longitude) || 0;
      const csvLat = parseFloat(csvItem.lat) || 0;
      const csvLng = parseFloat(csvItem.lng) || 0;
      
      const hasChanges = (
        existing.address !== csvItem.address ||
        existing.bookingUrl !== csvItem.bookingUrl ||
        Math.abs(existingLat - csvLat) > 0.0001 ||
        Math.abs(existingLng - csvLng) > 0.0001 ||
        existing.country !== csvItem.country
      );

      if (hasChanges) {
        differences.updated.push({
          existing,
          updated: csvItem
        });
      } else {
        differences.unchanged.push(csvItem);
      }
    }
  });

  return differences;
}

// AI-powered city extraction from CSV data
function extractCitiesFromCSV(csvData) {
  const cities = new Map();
  
  csvData.forEach(center => {
    if (!center.address || !center.name) return;
    
    // Extract city from address using various patterns
    const address = center.address.trim();
    let city = '';
    let region = '';
    let country = center.country || '';
    
    // Parse different address formats
    const addressParts = address.split(',').map(part => part.trim());
    
    if (addressParts.length >= 2) {
      // Try to identify city from address parts
      // Look for patterns like "City, State ZIP, Country" or "Street, City, State, Country"
      
      if (country.toLowerCase().includes('states')) {
        // US format: "Street, City, STATE ZIP"
        if (addressParts.length >= 3) {
          city = addressParts[1]; // Second part is usually city
          const stateZip = addressParts[2];
          region = stateZip.match(/([A-Z]{2})/)?.[1] || stateZip.split(' ')[0];
        }
      } else if (country.toLowerCase().includes('kingdom')) {
        // UK format: "Street, City, POSTCODE"
        city = addressParts[1]; // Second part is usually city
        region = 'England'; // Default region
        
        // Special UK city handling
        if (city.toLowerCase().includes('london')) {
          city = 'London';
        } else if (city.toLowerCase().includes('manchester')) {
          city = 'Manchester';
        } else if (city.toLowerCase().includes('birmingham')) {
          city = 'Birmingham';
        } else if (city.toLowerCase().includes('brighton')) {
          city = 'Brighton';
        } else if (city.toLowerCase().includes('leeds')) {
          city = 'Leeds';
        } else if (city.toLowerCase().includes('bristol')) {
          city = 'Bristol';
        } else if (city.toLowerCase().includes('liverpool')) {
          city = 'Liverpool';
        } else if (city.toLowerCase().includes('glasgow')) {
          city = 'Glasgow';
          region = 'Scotland';
        } else if (city.toLowerCase().includes('edinburgh')) {
          city = 'Edinburgh';
          region = 'Scotland';
        } else if (city.toLowerCase().includes('cardiff')) {
          city = 'Cardiff';
          region = 'Wales';
        }
      } else if (country.toLowerCase().includes('canada')) {
        // Canadian format: "Street, City, Province"
        if (addressParts.length >= 3) {
          city = addressParts[1];
          region = addressParts[2].split(' ')[0]; // Extract province
        }
      } else if (country.toLowerCase().includes('australia')) {
        // Australian format: "Street, City State POST, Country"
        if (addressParts.length >= 2) {
          const cityStatePart = addressParts[1];
          const parts = cityStatePart.split(' ');
          if (parts.length >= 2) {
            city = parts.slice(0, -2).join(' '); // Everything except last 2 words
            region = parts[parts.length - 2]; // Second to last is state
          } else {
            city = cityStatePart;
          }
        }
      } else {
        // Generic format: try to get city from second part
        city = addressParts[1];
      }
    }
    
    // Clean up city name
    city = city.replace(/\d+/g, '').replace(/[^\w\s-]/g, '').trim();
    
    // Skip if city extraction failed
    if (!city || city.length < 2) return;
    
    // Use coordinates from CSV if available
    const lat = parseFloat(center.lat);
    const lng = parseFloat(center.lng);
    
    if (isFinite(lat) && isFinite(lng)) {
      const cityKey = city.toLowerCase();
      const countryNormalized = country.toLowerCase().includes('states') ? 'united states' :
                                country.toLowerCase().includes('kingdom') ? 'united kingdom' :
                                country.toLowerCase().includes('canada') ? 'canada' :
                                country.toLowerCase().includes('australia') ? 'australia' :
                                country.toLowerCase();
      
      cities.set(cityKey, {
        lat: lat,
        lng: lng,
        city: city,
        region: region,
        country: countryNormalized,
        centerCount: (cities.get(cityKey)?.centerCount || 0) + 1
      });
    }
  });
  
  console.log(`🤖 AI extracted ${cities.size} unique cities from ${csvData.length} centers:`);
  cities.forEach((data, cityKey) => {
    console.log(`   📍 ${data.city}, ${data.region} (${data.country}) - ${data.centerCount} center(s)`);
  });
  
  return cities;
}

// Generate HTML from template with hardcoded data and AI-extracted cities
async function generateHtml(csvData) {
  const templatePath = path.join(__dirname, 'template-updated.html');
  const template = await fs.readFile(templatePath, 'utf8');
  
  // Extract cities using AI-powered analysis
  const extractedCities = extractCitiesFromCSV(csvData);
  
  // Convert extracted cities to the format expected by the template
  const cityDatabase = {};
  extractedCities.forEach((data, cityKey) => {
    cityDatabase[cityKey] = {
      lat: data.lat,
      lng: data.lng,
      city: data.city,
      region: data.region,
      country: data.country
    };
  });
  
  // Convert CSV data to JavaScript array format with proper structure
  const jsArray = JSON.stringify(csvData, null, 2);
  
  // Convert city database to JavaScript object format
  const cityDatabaseJs = JSON.stringify(cityDatabase, null, 2);
  
  // Replace placeholders with actual data
  let finalHtml = template.replace('__CSV_DATA_PLACEHOLDER__', jsArray);
  finalHtml = finalHtml.replace('__EXTRACTED_CITIES_PLACEHOLDER__', cityDatabaseJs);
  
  // Log generation info
  console.log(`📄 Generated HTML with ${csvData.length} hardcoded locations`);
  console.log(`🤖 AI extracted ${extractedCities.size} unique cities for manual correction`);
  const ukCount = csvData.filter(loc => loc.country && loc.country.toLowerCase().includes('kingdom')).length;
  const usaCount = csvData.filter(loc => loc.country && loc.country.toLowerCase().includes('states')).length;
  console.log(`   🇬🇧 UK locations: ${ukCount}, 🇺🇸 USA locations: ${usaCount}`);
  
  return finalHtml;
}

// Routes
app.post('/upload', upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Process CSV data
    const csvData = await processCsvData(req.file.path);
    
    if (csvData.length > 500) {
      return res.status(400).json({ error: 'Too many locations (max 500 allowed)' });
    }

    // Load existing database
    const db = await loadDatabase();

    // Compare with existing data
    const differences = compareWithDatabase(csvData, db);

    // Update database with new and updated entries
    const allNewData = [...differences.new, ...differences.updated.map(u => u.updated)];
    
    // Add new entries to database
    for (const newItem of differences.new) {
      const dbEntry = {
        id: `${newItem.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: newItem.name,
        address: newItem.address,
        cleanAddress: newItem.address,
        originalAddress: newItem.address,
        latitude: newItem.lat ? newItem.lat.toString() : null,
        longitude: newItem.lng ? newItem.lng.toString() : null,
        bookingUrl: newItem.bookingUrl,
        googleMapsLink: newItem.googlemaps || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(newItem.address)}`,
        dataQuality: 'excellent',
        issues: [],
        processed: new Date().toISOString(),
        country: newItem.country
      };
      db.locations.push(dbEntry);
    }

    // Update existing entries
    for (const update of differences.updated) {
      const existing = db.locations.find(loc => loc.name.toLowerCase().trim() === update.existing.name.toLowerCase().trim());
      if (existing) {
        existing.address = update.updated.address;
        existing.cleanAddress = update.updated.address;
        existing.latitude = update.updated.lat ? update.updated.lat.toString() : existing.latitude;
        existing.longitude = update.updated.lng ? update.updated.lng.toString() : existing.longitude;
        existing.bookingUrl = update.updated.bookingUrl;
        existing.country = update.updated.country;
        existing.processed = new Date().toISOString();
      }
    }

    // Save updated database
    await saveDatabase(db);

    // Generate HTML with hardcoded locations
    const generatedHtml = await generateHtml(csvData);
    
    // Clean up uploaded file
    await fs.unlink(req.file.path);
    
    // Prepare response with analysis
    const analysisReport = {
      totalProcessed: csvData.length,
      new: differences.new.length,
      updated: differences.updated.length,
      unchanged: differences.unchanged.length,
      newLocations: differences.new.map(loc => ({
        name: loc.name,
        address: loc.address,
        country: loc.country,
        hasCoordinates: !!(loc.lat && loc.lng)
      })),
      updatedLocations: differences.updated.map(u => ({
        name: u.updated.name,
        changes: {
          address: u.existing.address !== u.updated.address,
          coordinates: Math.abs((parseFloat(u.existing.latitude) || 0) - (parseFloat(u.updated.lat) || 0)) > 0.0001,
          bookingUrl: u.existing.bookingUrl !== u.updated.bookingUrl
        }
      }))
    };

    res.json({
      success: true,
      locationCount: csvData.length,
      html: generatedHtml,
      preview: csvData.slice(0, 5),
      analysis: analysisReport,
      databaseUpdated: true
    });

  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && fsSync.existsSync(req.file.path)) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    
    console.error('CSV processing error:', error.message);
    res.status(400).json({ 
      error: error.message || 'Failed to process CSV file',
      analysis: null
    });
  }
});

// Get database status
app.get('/api/status', async (req, res) => {
  try {
    const db = await loadDatabase();
    console.log(`📊 Status API: Found ${db.locations.length} locations, last updated: ${db.lastUpdated}`);
    res.json({
      success: true,
      status: 'operational',
      locations: db.locations.length,
      totalLocations: db.locations.length,
      lastUpdated: db.lastUpdated,
      databaseType: dbManager.useLocalDB ? 'JSON' : 'PostgreSQL',
      recentlyAdded: db.locations
        .filter(loc => new Date(loc.processed) > new Date(Date.now() - 24 * 60 * 60 * 1000))
        .length
    });
  } catch (error) {
    console.error('❌ Status API error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get database status',
      status: 'error',
      locations: 0
    });
  }
});

// === LIVE LOCATION FINDER API ENDPOINTS ===

// Calculate distance between two points using Haversine formula
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in miles
}

// Find nearest locations
app.get('/api/locations/nearest', async (req, res) => {
  try {
    const { lat, lng, limit = 5, unit = 'miles' } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    
    if (isNaN(userLat) || isNaN(userLng)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    const db = await loadDatabase();
    
    // Calculate distances and sort
    const locationsWithDistance = db.locations
      .filter(loc => loc.latitude && loc.longitude)
      .map(location => {
        const locLat = parseFloat(location.latitude);
        const locLng = parseFloat(location.longitude);
        const distance = calculateDistance(userLat, userLng, locLat, locLng);
        
        return {
          id: location.id,
          name: location.name,
          address: location.address,
          bookingUrl: location.bookingUrl,
          googleMapsLink: location.googleMapsLink,
          latitude: locLat,
          longitude: locLng,
          country: location.country,
          distance: unit === 'km' ? distance * 1.60934 : distance,
          unit: unit
        };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, parseInt(limit));

    res.json({
      success: true,
      userLocation: { lat: userLat, lng: userLng },
      locations: locationsWithDistance,
      total: locationsWithDistance.length
    });

  } catch (error) {
    console.error('Error finding nearest locations:', error);
    res.status(500).json({ error: 'Failed to find nearest locations' });
  }
});

// Global geocoding using OpenStreetMap Nominatim
async function geocodeWithNominatim(address) {
  try {
    // OpenStreetMap Nominatim API (free, no API key required)
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&addressdetails=1`;
    
    const response = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'EESystem-LocationFinder/1.0 (https://ee-system.com)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.length > 0) {
      const result = data[0];
      const addressComponents = result.address || {};
      
      return {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
        city: addressComponents.city || addressComponents.town || addressComponents.village || 
              addressComponents.municipality || result.display_name.split(',')[0],
        country: addressComponents.country || 'Unknown',
        display_name: result.display_name
      };
    }
    
    return null;
  } catch (error) {
    console.error('Nominatim geocoding error:', error);
    return null;
  }
}

// Fallback geocoding for common locations (when Nominatim fails)
function getFallbackCoordinates(query) {
  const normalizedQuery = query.toLowerCase().trim();
  
  // Common fallbacks for major cities worldwide
  const fallbackCoordinates = {
    // USA
    'new york': { lat: 40.7128, lng: -74.0060, city: 'New York', country: 'United States' },
    'los angeles': { lat: 34.0522, lng: -118.2437, city: 'Los Angeles', country: 'United States' },
    'chicago': { lat: 41.8781, lng: -87.6298, city: 'Chicago', country: 'United States' },
    'las vegas': { lat: 36.1699, lng: -115.1398, city: 'Las Vegas', country: 'United States' },
    'phoenix': { lat: 33.4484, lng: -112.0740, city: 'Phoenix', country: 'United States' },
    'houston': { lat: 29.7604, lng: -95.3698, city: 'Houston', country: 'United States' },
    'dallas': { lat: 32.7767, lng: -96.7970, city: 'Dallas', country: 'United States' },
    'miami': { lat: 25.7617, lng: -80.1918, city: 'Miami', country: 'United States' },
    'atlanta': { lat: 33.7490, lng: -84.3880, city: 'Atlanta', country: 'United States' },
    'seattle': { lat: 47.6062, lng: -122.3321, city: 'Seattle', country: 'United States' },
    
    // UK
    'london': { lat: 51.5074, lng: -0.1278, city: 'London', country: 'United Kingdom' },
    'manchester': { lat: 53.4808, lng: -2.2426, city: 'Manchester', country: 'United Kingdom' },
    'birmingham': { lat: 52.4862, lng: -1.8904, city: 'Birmingham', country: 'United Kingdom' },
    'liverpool': { lat: 53.4084, lng: -2.9916, city: 'Liverpool', country: 'United Kingdom' },
    'leeds': { lat: 53.8008, lng: -1.5491, city: 'Leeds', country: 'United Kingdom' },
    
    // International
    'paris': { lat: 48.8566, lng: 2.3522, city: 'Paris', country: 'France' },
    'sydney': { lat: -33.8688, lng: 151.2093, city: 'Sydney', country: 'Australia' },
    'melbourne': { lat: -37.8136, lng: 144.9631, city: 'Melbourne', country: 'Australia' },
    'toronto': { lat: 43.6532, lng: -79.3832, city: 'Toronto', country: 'Canada' },
    'dublin': { lat: 53.3498, lng: -6.2603, city: 'Dublin', country: 'Ireland' },
    'amsterdam': { lat: 52.3676, lng: 4.9041, city: 'Amsterdam', country: 'Netherlands' },
    'berlin': { lat: 52.5200, lng: 13.4050, city: 'Berlin', country: 'Germany' },
    'rome': { lat: 41.9028, lng: 12.4964, city: 'Rome', country: 'Italy' },
    'madrid': { lat: 40.4168, lng: -3.7038, city: 'Madrid', country: 'Spain' }
  };
  
  return fallbackCoordinates[normalizedQuery] || null;
}

// Rate limiter for Nominatim API (max 1 request per second)
let lastNominatimRequest = 0;
async function rateLimitedGeocode(address) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastNominatimRequest;
  
  if (timeSinceLastRequest < 1000) {
    // Wait to respect rate limit
    await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastRequest));
  }
  
  lastNominatimRequest = Date.now();
  return await geocodeWithNominatim(address);
}

// Geocode address/postcode to coordinates
app.post('/api/locations/geocode', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address || !address.trim()) {
      return res.status(400).json({ error: 'Address is required' });
    }

    const query = address.trim();
    console.log(`🔍 Geocoding request: "${query}"`);
    
    // Try OpenStreetMap Nominatim first (global coverage)
    let coordinates = await rateLimitedGeocode(query);
    
    // If Nominatim fails, try fallback for common locations
    if (!coordinates) {
      coordinates = getFallbackCoordinates(query);
      if (coordinates) {
        console.log(`✅ Using fallback coordinates for: ${query}`);
      }
    } else {
      console.log(`✅ Nominatim geocoding successful for: ${query}`);
    }
    
    if (!coordinates) {
      console.log(`❌ Geocoding failed for: ${query}`);
      return res.status(404).json({ 
        error: 'Location not found',
        suggestion: 'Try searching for a city name, postal code, or address. Examples: "Paris", "10001", "M1 1AA"'
      });
    }
    
    res.json({
      success: true,
      query: query,
      coordinates: coordinates
    });

  } catch (error) {
    console.error('Error geocoding address:', error);
    res.status(500).json({ error: 'Failed to geocode address' });
  }
});

// Search locations by name or address
app.get('/api/locations/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q || !q.trim()) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const db = await loadDatabase();
    const query = q.trim().toLowerCase();
    
    // Search in name, address, and country
    const matchingLocations = db.locations
      .filter(location => {
        const name = (location.name || '').toLowerCase();
        const address = (location.address || '').toLowerCase();
        const country = (location.country || '').toLowerCase();
        
        return name.includes(query) || 
               address.includes(query) || 
               country.includes(query);
      })
      .slice(0, parseInt(limit))
      .map(location => ({
        id: location.id,
        name: location.name,
        address: location.address,
        bookingUrl: location.bookingUrl,
        googleMapsLink: location.googleMapsLink,
        latitude: parseFloat(location.latitude),
        longitude: parseFloat(location.longitude),
        country: location.country
      }));

    res.json({
      success: true,
      query: q,
      locations: matchingLocations,
      total: matchingLocations.length
    });

  } catch (error) {
    console.error('Error searching locations:', error);
    res.status(500).json({ error: 'Failed to search locations' });
  }
});

// Get all locations for the finder
app.get('/api/locations', async (req, res) => {
  try {
    const db = await loadDatabase();
    
    const locations = db.locations.map(location => ({
      id: location.id,
      name: location.name,
      address: location.address,
      bookingUrl: location.bookingUrl,
      googleMapsLink: location.googleMapsLink,
      latitude: parseFloat(location.latitude),
      longitude: parseFloat(location.longitude),
      country: location.country
    }));

    res.json({
      success: true,
      locations: locations,
      total: locations.length,
      lastUpdated: db.lastUpdated
    });

  } catch (error) {
    console.error('Error getting locations:', error);
    res.status(500).json({ error: 'Failed to get locations' });
  }
});

// IP-based geolocation endpoint
app.get('/api/locations/ip-location', async (req, res) => {
  try {
    // Enhanced IP detection for cloud environments (Render, Vercel, etc.)
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                     req.headers['cf-connecting-ip'] ||  // Cloudflare
                     req.headers['x-real-ip'] || 
                     req.headers['x-client-ip'] ||
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress ||
                     (req.connection.socket ? req.connection.socket.remoteAddress : null);

    console.log(`🌐 IP Geolocation request - Client IP: ${clientIP}`);

    // If localhost or private IP, use Manchester coordinates for UK testing
    if (!clientIP || 
        clientIP === '127.0.0.1' || 
        clientIP === '::1' || 
        clientIP.includes('localhost') ||
        clientIP.startsWith('192.168.') ||
        clientIP.startsWith('10.') ||
        clientIP.startsWith('172.')) {
      console.log('🏠 Local/private IP detected - using Manchester UK for testing');
      return res.json({
        success: true,
        location: {
          lat: 53.4808,
          lng: -2.2426,
          city: 'Manchester',
          country: 'United Kingdom',
          source: 'development_default'
        }
      });
    }

    console.log(`🔍 Attempting IP geolocation for: ${clientIP}`);

    // Try multiple IP geolocation services for better reliability
    let locationData = null;
    
    // Service 1: ip-api.com (free, good coverage)
    try {
      const response1 = await fetch(`http://ip-api.com/json/${clientIP}?fields=status,country,regionName,city,lat,lon,query`, {
        timeout: 5000,
        headers: {
          'User-Agent': 'EESystem-LocationFinder/2.0'
        }
      });
      
      if (response1.ok) {
        const data = await response1.json();
        console.log(`📡 IP-API response:`, data);
        
        if (data.status === 'success' && data.lat && data.lon) {
          locationData = {
            lat: data.lat,
            lng: data.lon,
            city: data.city,
            region: data.regionName,
            country: data.country,
            source: 'ip-api.com'
          };
        }
      }
    } catch (error) {
      console.log(`❌ IP-API failed:`, error.message);
    }

    // Service 2: ipapi.co (backup service)
    if (!locationData) {
      try {
        const response2 = await fetch(`https://ipapi.co/${clientIP}/json/`, {
          timeout: 5000,
          headers: {
            'User-Agent': 'EESystem-LocationFinder/2.0'
          }
        });
        
        if (response2.ok) {
          const data = await response2.json();
          console.log(`📡 IPAPI.co response:`, data);
          
          if (data.latitude && data.longitude && !data.error) {
            locationData = {
              lat: data.latitude,
              lng: data.longitude,
              city: data.city,
              region: data.region,
              country: data.country_name,
              source: 'ipapi.co'
            };
          }
        }
      } catch (error) {
        console.log(`❌ IPAPI.co failed:`, error.message);
      }
    }

    // Service 3: Basic geolocation based on country headers
    if (!locationData) {
      const countryHeader = req.headers['cf-ipcountry'] || req.headers['x-country-code'];
      if (countryHeader) {
        console.log(`🏴 Country header detected: ${countryHeader}`);
        locationData = getLocationFromCountryCode(countryHeader);
        if (locationData) {
          locationData.source = 'country_header';
        }
      }
    }

    if (locationData) {
      console.log(`✅ IP geolocation successful:`, locationData);
      res.json({
        success: true,
        location: locationData
      });
    } else {
      // Smart fallback - return null to trigger manual search instead of wrong location
      console.log(`❌ All IP geolocation services failed for ${clientIP}`);
      res.json({
        success: false,
        location: null,
        message: 'IP geolocation failed - please use manual search or GPS location'
      });
    }

  } catch (error) {
    console.error('IP geolocation error:', error);
    res.json({
      success: false,
      location: null,
      message: 'IP geolocation failed - please use manual search or GPS location'
    });
  }
});

// Helper function to get approximate location from country code
function getLocationFromCountryCode(countryCode) {
  const countryLocations = {
    'GB': { lat: 53.0, lng: -2.5, city: 'United Kingdom', country: 'United Kingdom' },
    'US': { lat: 39.8, lng: -98.5, city: 'United States', country: 'United States' },
    'CA': { lat: 56.1, lng: -106.3, city: 'Canada', country: 'Canada' },
    'AU': { lat: -25.2, lng: 133.7, city: 'Australia', country: 'Australia' },
    'DE': { lat: 51.2, lng: 10.4, city: 'Germany', country: 'Germany' },
    'FR': { lat: 46.6, lng: 2.2, city: 'France', country: 'France' },
    'ES': { lat: 40.5, lng: -3.7, city: 'Spain', country: 'Spain' },
    'IT': { lat: 41.9, lng: 12.6, city: 'Italy', country: 'Italy' },
    'NL': { lat: 52.1, lng: 5.3, city: 'Netherlands', country: 'Netherlands' },
    'IE': { lat: 53.4, lng: -8.2, city: 'Ireland', country: 'Ireland' }
  };
  
  return countryLocations[countryCode.toUpperCase()] || null;
}

// Get unique countries from database
app.get('/api/locations/countries', async (req, res) => {
  try {
    const db = await loadDatabase();
    
    // Extract unique countries, fix data inconsistencies, and sort
    const countries = [...new Set(
      db.locations
        .map(location => location.country)
        .filter(country => country && country.trim()) // Remove null/empty
        .map(country => {
          // Fix common typos
          if (country.toLowerCase().includes('austalia')) {
            return 'Australia';
          }
          return country.trim();
        })
    )].sort();

    res.json({
      success: true,
      countries: countries,
      total: countries.length
    });

  } catch (error) {
    console.error('Error getting countries:', error);
    res.status(500).json({ error: 'Failed to get countries' });
  }
});

// Get cities by country
app.get('/api/locations/cities/:country', async (req, res) => {
  try {
    const { country } = req.params;
    const db = await loadDatabase();
    
    // Extract cities from addresses for the specified country
    const locations = db.locations.filter(location => {
      const locationCountry = location.country?.trim();
      return locationCountry === country || 
             (locationCountry?.toLowerCase().includes('austalia') && country === 'Australia');
    });

    // Enhanced city extraction from addresses
    const cities = [...new Set(
      locations
        .map(location => {
          const address = location.address || '';
          let cityName = '';
          
          if (country === 'United States') {
            // US format: "Street Address, City, STATE ZIP"
            // Examples: "3575 Maple Ave, Zanesville, OH 43701, USA"
            //          "16775 Addison Rd. #325 Addison, TX 75001"
            const parts = address.split(',').map(p => p.trim());
            
            if (parts.length >= 3) {
              // Look for the part before STATE (2-letter code)
              for (let i = 1; i < parts.length - 1; i++) {
                const nextPart = parts[i + 1];
                // Check if next part starts with 2-letter state code
                if (nextPart && nextPart.match(/^\s*[A-Z]{2}(\s+\d|$)/)) {
                  cityName = parts[i];
                  break;
                }
              }
              
              // Fallback: if no state pattern found, use second part (most common)
              if (!cityName && parts.length >= 2) {
                cityName = parts[1];
              }
            } else if (parts.length === 2) {
              // Simple format: "Street, City STATE ZIP"
              const secondPart = parts[1];
              // Extract city before state
              const match = secondPart.match(/^(.+?)\s+[A-Z]{2}/);
              if (match) {
                cityName = match[1];
              } else {
                cityName = secondPart.split(/\s+/)[0]; // First word
              }
            }
          } else if (country === 'Canada') {
            // Canadian format: "Street, City, Province/Territory"
            const parts = address.split(',').map(p => p.trim());
            if (parts.length >= 3) {
              // Look for part before province
              for (let i = 1; i < parts.length - 1; i++) {
                const nextPart = parts[i + 1];
                // Check if next part looks like province
                if (nextPart && nextPart.match(/^\s*(ON|BC|AB|SK|MB|QC|NB|NS|PE|NL|YT|NT|NU)/)) {
                  cityName = parts[i];
                  break;
                }
              }
              // Fallback to second part
              if (!cityName) {
                cityName = parts[1];
              }
            }
          } else {
            // For other countries, use smarter extraction
            const parts = address.split(',').map(p => p.trim());
            
            if (country === 'Australia') {
              // Australian format: "Street, City STATE POST"
              if (parts.length >= 2) {
                const secondPart = parts[1];
                // Remove state and postcode
                cityName = secondPart.replace(/\s+(VIC|NSW|QLD|WA|SA|TAS|ACT|NT)\s+\d+.*$/, '').trim();
              }
            } else if (country === 'United Kingdom') {
              // UK format: "Street, City, POSTCODE"
              if (parts.length >= 2) {
                cityName = parts[1];
                // Clean postcode patterns
                cityName = cityName.replace(/\s+[A-Z]{1,2}\d+\s*\d*[A-Z]{0,2}.*$/, '').trim();
              }
            } else {
              // Generic: take second part if available, otherwise first
              if (parts.length >= 2) {
                cityName = parts[1];
              } else if (parts.length === 1) {
                // Single part - might be "City, Country" format
                cityName = parts[0];
              }
            }
          }
          
          // Clean up city name
          if (cityName) {
            // Remove common address elements
            cityName = cityName.replace(/^\d+\s+/, ''); // Remove leading numbers
            cityName = cityName.replace(/\s+(St|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Suite|#)\s*\d*.*$/i, ''); // Remove street suffixes
            cityName = cityName.replace(/\s+(USA|United States|UK|United Kingdom|Canada|Australia)$/i, ''); // Remove country names
            cityName = cityName.replace(/,.*$/, ''); // Remove everything after comma
            cityName = cityName.trim();
            
            // Validate city name
            if (cityName.length > 1 && !cityName.match(/^\d+$/) && !cityName.match(/^(suite|unit|#|\d)/i)) {
              return cityName;
            }
          }
          
          return null;
        })
        .filter(city => city && city.length > 2) // Filter valid city names
    )].sort();

    console.log(`🏙️ Extracted ${cities.length} cities for ${country}:`, cities.slice(0, 10));

    res.json({
      success: true,
      country: country,
      cities: cities,
      total: cities.length
    });

  } catch (error) {
    console.error('Error getting cities:', error);
    res.status(500).json({ error: 'Failed to get cities' });
  }
});

// Get locations by country, city, or postal code
app.get('/api/locations/by-location', async (req, res) => {
  try {
    const { country, city, postal, limit = 20 } = req.query;
    const db = await loadDatabase();
    
    let filteredLocations = db.locations;
    
    // Filter by country
    if (country) {
      filteredLocations = filteredLocations.filter(location => {
        const locationCountry = location.country?.trim();
        return locationCountry === country || 
               (locationCountry?.toLowerCase().includes('austalia') && country === 'Australia');
      });
    }
    
    // Filter by city if provided
    if (city) {
      filteredLocations = filteredLocations.filter(location => {
        const address = (location.address || '').toLowerCase();
        return address.includes(city.toLowerCase());
      });
    }
    
    // Filter by postal code if provided
    if (postal) {
      filteredLocations = filteredLocations.filter(location => {
        const address = (location.address || '').toLowerCase();
        return address.includes(postal.toLowerCase());
      });
    }
    
    // Format and limit results
    const results = filteredLocations
      .slice(0, parseInt(limit))
      .map(location => ({
        id: location.id,
        name: location.name,
        address: location.address,
        bookingUrl: location.bookingUrl,
        googleMapsLink: location.googleMapsLink,
        latitude: parseFloat(location.latitude),
        longitude: parseFloat(location.longitude),
        country: location.country
      }));

    res.json({
      success: true,
      filters: { country, city, postal },
      locations: results,
      total: results.length
    });

  } catch (error) {
    console.error('Error getting locations by filter:', error);
    res.status(500).json({ error: 'Failed to get locations' });
  }
});

// Make.com Webhook Integration
app.post('/webhook/make-com', async (req, res) => {
  try {
    console.log('📡 Make.com webhook received:', JSON.stringify(req.body, null, 2));
    
    const webhookData = req.body;
    
    // Validate webhook data structure
    if (!webhookData || typeof webhookData !== 'object') {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid webhook data format' 
      });
    }
    
    // Handle different types of updates
    if (Array.isArray(webhookData)) {
      // Batch update - array of locations
      const results = await processBatchUpdate(webhookData);
      res.json({
        success: true,
        message: 'Batch update processed successfully',
        processed: results.processed,
        errors: results.errors,
        timestamp: new Date().toISOString()
      });
    } else if (webhookData.name || webhookData.address) {
      // Single location update
      const result = await processSingleLocationUpdate(webhookData);
      res.json({
        success: true,
        message: 'Location update processed successfully',
        location: result.location,
        action: result.action,
        timestamp: new Date().toISOString()
      });
    } else {
      // Unknown format
      res.status(400).json({
        success: false,
        error: 'Unrecognized webhook data structure',
        receivedFields: Object.keys(webhookData)
      });
    }
    
  } catch (error) {
    console.error('❌ Make.com webhook error:', error);
    res.status(500).json({
      success: false,
      error: 'Webhook processing failed',
      message: error.message
    });
  }
});

// Process single location update from Make.com
async function processSingleLocationUpdate(locationData) {
  const db = await loadDatabase();
  
  // Clean and validate the incoming data
  const cleanData = {
    name: sanitizeString(locationData.name || '').trim(),
    address: sanitizeString(locationData.address || '').trim(),
    bookingUrl: locationData.bookingUrl ? ensureHttps(locationData.bookingUrl.trim()) : '',
    lat: parseFloat(locationData.lat) || null,
    lng: parseFloat(locationData.lng) || null,
    country: sanitizeString(locationData.country || '').trim(),
    googlemaps: locationData.googlemaps ? locationData.googlemaps.trim() : ''
  };
  
  // Validate required fields
  if (!cleanData.name || !cleanData.address) {
    throw new Error('Missing required fields: name and address');
  }
  
  // Check if location already exists
  const existingLocation = db.locations.find(loc => 
    loc.name.toLowerCase().trim() === cleanData.name.toLowerCase().trim()
  );
  
  let action = '';
  
  if (existingLocation) {
    // Update existing location
    existingLocation.address = cleanData.address;
    existingLocation.cleanAddress = cleanData.address;
    existingLocation.latitude = cleanData.lat ? cleanData.lat.toString() : existingLocation.latitude;
    existingLocation.longitude = cleanData.lng ? cleanData.lng.toString() : existingLocation.longitude;
    existingLocation.bookingUrl = cleanData.bookingUrl || existingLocation.bookingUrl;
    existingLocation.country = cleanData.country || existingLocation.country;
    existingLocation.googleMapsLink = cleanData.googlemaps || existingLocation.googleMapsLink;
    existingLocation.processed = new Date().toISOString();
    
    action = 'updated';
    console.log(`✅ Updated location: ${cleanData.name}`);
  } else {
    // Create new location
    const newLocation = {
      id: `${cleanData.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: cleanData.name,
      address: cleanData.address,
      cleanAddress: cleanData.address,
      originalAddress: cleanData.address,
      latitude: cleanData.lat ? cleanData.lat.toString() : null,
      longitude: cleanData.lng ? cleanData.lng.toString() : null,
      bookingUrl: cleanData.bookingUrl,
      googleMapsLink: cleanData.googlemaps || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanData.address)}`,
      dataQuality: 'excellent',
      issues: [],
      processed: new Date().toISOString(),
      country: cleanData.country,
      source: 'make.com'
    };
    
    db.locations.push(newLocation);
    action = 'created';
    console.log(`✅ Created new location: ${cleanData.name}`);
  }
  
  // Save updated database
  await saveDatabase(db);
  
  return {
    location: cleanData,
    action: action
  };
}

// Process batch update from Make.com
async function processBatchUpdate(locationsArray) {
  const results = {
    processed: 0,
    errors: []
  };
  
  for (const locationData of locationsArray) {
    try {
      await processSingleLocationUpdate(locationData);
      results.processed++;
    } catch (error) {
      results.errors.push({
        location: locationData.name || 'Unknown',
        error: error.message
      });
      console.error(`❌ Failed to process location: ${locationData.name}`, error.message);
    }
  }
  
  return results;
}

// Test endpoint for webhook (for development/testing)
app.get('/webhook/make-com/test', (req, res) => {
  res.json({
    success: true,
    message: 'Make.com webhook endpoint is working',
    timestamp: new Date().toISOString(),
    endpoints: {
      webhook: '/webhook/make-com',
      method: 'POST',
      expectedData: {
        single: {
          name: 'Center Name',
          address: 'Full Address',
          bookingUrl: 'https://...',
          lat: 'Latitude',
          lng: 'Longitude', 
          country: 'Country Name',
          googlemaps: 'Google Maps Link (optional)'
        },
        batch: '[array of location objects]'
      }
    }
  });
});

// Serve sample CSV file
app.get('/sample.csv', (req, res) => {
  const sampleCsv = `name,address,bookingUrl,lat,lng,country,googlemaps
ArkLaTex EEnergy Healing Center,"4059 Summerhill Rd, Texarkana, TX 75503, USA",https://ee-system.com/arklatex-eenergy-healing-center-2754,33.4554566,-94.06533436,United States,
CenTex EEnergy,"121 Bulverde Crossing #112, Bulverde, TX 78163, USA",https://ee-system.com/centex-eenergy-5300,29.795868,-98.423117,United States,`;
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sample.csv"');
  res.send(sampleCsv);
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 5MB)' });
    }
  }
  
  if (error.message === 'Only CSV files are allowed!') {
    return res.status(400).json({ error: 'Only CSV files are allowed' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// Create uploads directory if it doesn't exist
fsSync.mkdirSync('uploads', { recursive: true });

// Initialize database and start server
async function startServer() {
  try {
    // Connect to database
    await dbManager.connect();
    
    // Start Express server
    app.listen(port, () => {
      console.log(`AI-Enhanced EESystem Location Webapp running at http://localhost:${port}`);
      console.log('Features:');
      console.log('- CSV upload with database comparison');
      console.log('- Hardcoded locations for fast loading');
      console.log('- AI-powered difference detection');
      console.log('- Database persistence with PostgreSQL/JSON fallback');
      console.log(`- Storage mode: ${dbManager.useLocalDB ? 'Local JSON' : 'PostgreSQL'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n📴 Shutting down gracefully...');
  await dbManager.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n📴 Shutting down gracefully...');
  await dbManager.disconnect();
  process.exit(0);
});

// Start the server
startServer();
