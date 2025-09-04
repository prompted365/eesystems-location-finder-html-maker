const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const validator = require('validator');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3001;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many requests from this IP, please try again later.'
});

app.use(limiter);
app.use(express.static('public'));
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

// Load database
async function loadDatabase() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { locations: [], lastUpdated: new Date().toISOString() };
  }
}

// Save database
async function saveDatabase(db) {
  db.lastUpdated = new Date().toISOString();
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
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

        // Validate required fields
        if (!csvData.name || !csvData.address || !csvData.bookingUrl) {
          errors.push(`Row ${rowCount}: Missing required fields (name: "${csvData.name}", address: "${csvData.address}", booking URL: "${csvData.bookingUrl}")`);
          return;
        }

        // Validate booking URL
        if (!validateUrl(csvData.bookingUrl)) {
          errors.push(`Row ${rowCount}: Invalid booking URL format: "${csvData.bookingUrl}"`);
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
      const hasChanges = (
        existing.address !== csvItem.address ||
        existing.bookingUrl !== csvItem.bookingUrl ||
        Math.abs((existing.latitude || 0) - (csvItem.lat || 0)) > 0.0001 ||
        Math.abs((existing.longitude || 0) - (csvItem.lng || 0)) > 0.0001 ||
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

// Generate HTML from template with hardcoded data
async function generateHtml(csvData) {
  const templatePath = path.join(__dirname, 'template-updated.html');
  const template = await fs.readFile(templatePath, 'utf8');
  
  // Convert CSV data to JavaScript array format with proper structure
  const jsArray = JSON.stringify(csvData, null, 2);
  
  // Replace placeholder with actual data
  const finalHtml = template.replace('__CSV_DATA_PLACEHOLDER__', jsArray);
  
  // Log generation info
  console.log(`📄 Generated HTML with ${csvData.length} hardcoded locations`);
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
          coordinates: Math.abs((u.existing.latitude || 0) - (u.updated.lat || 0)) > 0.0001,
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

app.listen(port, () => {
  console.log(`AI-Enhanced EESystem Location Webapp running at http://localhost:${port}`);
  console.log('Features:');
  console.log('- CSV upload with database comparison');
  console.log('- Hardcoded locations for fast loading');
  console.log('- AI-powered difference detection');
  console.log('- Database persistence and updates');
});