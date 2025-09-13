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
app.use(express.static('public'));

// Redirect root to location finder
app.get('/', (req, res) => {
  res.redirect('/finder');
});

// Serve the location finder page
app.get('/finder', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'finder.html'));
});

// Admin interface for CSV management
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
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
    res.json({
      totalLocations: db.locations.length,
      lastUpdated: db.lastUpdated,
      recentlyAdded: db.locations
        .filter(loc => new Date(loc.processed) > new Date(Date.now() - 24 * 60 * 60 * 1000))
        .length
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get database status' });
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

// Geocode address/postcode to coordinates
app.post('/api/locations/geocode', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address || !address.trim()) {
      return res.status(400).json({ error: 'Address is required' });
    }

    // For now, we'll use a simple UK postcode pattern recognition
    // In production, you'd integrate with a proper geocoding service
    const ukPostcodePattern = /^[A-Z]{1,2}[0-9R][0-9A-Z]?\s?[0-9][A-Z]{2}$/i;
    const query = address.trim();
    
    // Mock geocoding - replace with actual service like Google Geocoding API
    let coordinates = null;
    
    if (ukPostcodePattern.test(query)) {
      // Mock UK postcode geocoding
      const mockUKCoordinates = {
        'M1 1AA': { lat: 53.4808, lng: -2.2426, city: 'Manchester', country: 'United Kingdom' },
        'SW1A 1AA': { lat: 51.5014, lng: -0.1419, city: 'London', country: 'United Kingdom' },
        'B1 1AA': { lat: 52.4862, lng: -1.8904, city: 'Birmingham', country: 'United Kingdom' },
        'EH1 1AA': { lat: 55.9533, lng: -3.1883, city: 'Edinburgh', country: 'United Kingdom' },
        'L1 1AA': { lat: 53.4084, lng: -2.9916, city: 'Liverpool', country: 'United Kingdom' }
      };
      
      // Try exact match first, then approximate
      const normalizedPostcode = query.toUpperCase().replace(/\s+/g, ' ');
      coordinates = mockUKCoordinates[normalizedPostcode];
      
      if (!coordinates) {
        // Generate approximate coordinates for UK postcodes
        const firstPart = normalizedPostcode.split(' ')[0];
        const baseCoords = {
          'M': { lat: 53.4808, lng: -2.2426, city: 'Manchester', country: 'United Kingdom' },
          'L': { lat: 53.4084, lng: -2.9916, city: 'Liverpool', country: 'United Kingdom' },
          'B': { lat: 52.4862, lng: -1.8904, city: 'Birmingham', country: 'United Kingdom' },
          'SW': { lat: 51.5014, lng: -0.1419, city: 'London', country: 'United Kingdom' },
          'SE': { lat: 51.4545, lng: -0.0759, city: 'London', country: 'United Kingdom' },
          'E': { lat: 51.5287, lng: -0.0436, city: 'London', country: 'United Kingdom' },
          'N': { lat: 51.5630, lng: -0.1063, city: 'London', country: 'United Kingdom' }
        };
        
        const prefix = firstPart.substring(0, 2);
        coordinates = baseCoords[prefix] || baseCoords[firstPart.charAt(0)];
      }
    } else {
      // Mock city/address geocoding - expanded with more cities
      const mockCityCoordinates = {
        'manchester': { lat: 53.4808, lng: -2.2426, city: 'Manchester', country: 'United Kingdom' },
        'london': { lat: 51.5074, lng: -0.1278, city: 'London', country: 'United Kingdom' },
        'birmingham': { lat: 52.4862, lng: -1.8904, city: 'Birmingham', country: 'United Kingdom' },
        'liverpool': { lat: 53.4084, lng: -2.9916, city: 'Liverpool', country: 'United Kingdom' },
        'leeds': { lat: 53.8008, lng: -1.5491, city: 'Leeds', country: 'United Kingdom' },
        'new york': { lat: 40.7128, lng: -74.0060, city: 'New York', country: 'United States' },
        'los angeles': { lat: 34.0522, lng: -118.2437, city: 'Los Angeles', country: 'United States' },
        'chicago': { lat: 41.8781, lng: -87.6298, city: 'Chicago', country: 'United States' },
        'las vegas': { lat: 36.1699, lng: -115.1398, city: 'Las Vegas', country: 'United States' },
        'phoenix': { lat: 33.4484, lng: -112.0740, city: 'Phoenix', country: 'United States' },
        'houston': { lat: 29.7604, lng: -95.3698, city: 'Houston', country: 'United States' },
        'dallas': { lat: 32.7767, lng: -96.7970, city: 'Dallas', country: 'United States' },
        'san francisco': { lat: 37.7749, lng: -122.4194, city: 'San Francisco', country: 'United States' },
        'miami': { lat: 25.7617, lng: -80.1918, city: 'Miami', country: 'United States' },
        'atlanta': { lat: 33.7490, lng: -84.3880, city: 'Atlanta', country: 'United States' },
        'seattle': { lat: 47.6062, lng: -122.3321, city: 'Seattle', country: 'United States' },
        'denver': { lat: 39.7392, lng: -104.9903, city: 'Denver', country: 'United States' },
        'austin': { lat: 30.2672, lng: -97.7431, city: 'Austin', country: 'United States' },
        'san diego': { lat: 32.7157, lng: -117.1611, city: 'San Diego', country: 'United States' },
        'portland': { lat: 45.5152, lng: -122.6784, city: 'Portland', country: 'United States' }
      };
      
      const normalizedQuery = query.toLowerCase();
      coordinates = mockCityCoordinates[normalizedQuery];
    }
    
    if (!coordinates) {
      return res.status(404).json({ 
        error: 'Location not found',
        suggestion: 'Try a UK postcode (e.g., M1 1AA) or major city name'
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