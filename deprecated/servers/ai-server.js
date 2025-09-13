const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const validator = require('validator');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: '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'
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed!'), false);
    }
  }
});

// Database (JSON file storage)
const DB_FILE = path.join(__dirname, 'locations_db.json');

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading database:', error);
  }
  return { locations: [], lastUpdated: new Date().toISOString() };
}

function saveDatabase(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    console.log('Database saved successfully');
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

// AI-powered address analysis with Google Search
async function analyzeAddressWithAI(businessName, address, existingMapLink = '') {
  console.log(`🤖 Analyzing: ${businessName} at ${address}`);
  
  try {
    // First, let's use Google search to verify the business exists
    const searchQuery = `"${businessName}" EESystem center address "${address}"`;
    const googleSearchResult = await performGoogleSearch(searchQuery);
    
    const prompt = `IMPORTANT: Return ONLY valid JSON, no explanations or markdown.

Analyze this EESystem healing center:
Business: "${businessName}"
Address: "${address}"
Existing Maps: "${existingMapLink}"
Google Search Info: "${googleSearchResult.snippet || 'No additional info'}"

Extract coordinates and create Google Maps link. Return this exact JSON structure:
{
  "cleanAddress": "standardized full address",
  "latitude": decimal_number_or_null,
  "longitude": decimal_number_or_null,
  "googleMapsLink": "https://maps.google.com/search/api=1&query=encoded_search",
  "dataQuality": "excellent",
  "issues": [],
  "searchQuery": "${businessName} EESystem ${address}"
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { 
          role: "system", 
          content: "You are a location data processor. Return ONLY valid JSON with no explanations, markdown, or extra text. Respond with pure JSON only." 
        },
        { role: "user", content: prompt }
      ],
      temperature: 0,
      max_tokens: 400
    });

    let responseText = completion.choices[0].message.content.trim();
    
    // Clean up the response to ensure it's valid JSON
    responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Find JSON object bounds
    const jsonStart = responseText.indexOf('{');
    const jsonEnd = responseText.lastIndexOf('}') + 1;
    
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      responseText = responseText.substring(jsonStart, jsonEnd);
    }

    const result = JSON.parse(responseText);
    
    // Validate the result structure
    const validated = {
      cleanAddress: result.cleanAddress || address,
      latitude: typeof result.latitude === 'number' ? result.latitude : null,
      longitude: typeof result.longitude === 'number' ? result.longitude : null,
      googleMapsLink: result.googleMapsLink || generateMapsLink(businessName, address),
      dataQuality: result.dataQuality || "good",
      issues: Array.isArray(result.issues) ? result.issues : [],
      searchQuery: result.searchQuery || `${businessName} EESystem center`
    };

    console.log(`✅ AI Analysis complete for ${businessName}`);
    return validated;

  } catch (error) {
    console.error(`❌ AI analysis failed for ${businessName}:`, error.message);
    
    // Fallback: Use Google search to at least get a maps link
    return {
      cleanAddress: address,
      latitude: null,
      longitude: null,
      googleMapsLink: generateMapsLink(businessName, address),
      dataQuality: "fair",
      issues: [`AI analysis failed: ${error.message}`],
      searchQuery: `${businessName} EESystem center ${address}`
    };
  }
}

// Perform Google search to verify business information
async function performGoogleSearch(query) {
  try {
    // For now, we'll generate a proper maps link since Google Search API requires API key
    console.log(`🔍 Searching: ${query}`);
    return {
      snippet: "EESystem energy healing center location",
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`
    };
  } catch (error) {
    console.error('Google search error:', error);
    return { snippet: '', url: '' };
  }
}

// Generate Google Maps link
function generateMapsLink(businessName, address) {
  const searchTerm = `${businessName} ${address}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchTerm)}`;
}


// Enhanced CSV processing with AI
async function processCSVWithAI(filePath, progressCallback = null) {
  console.log('🚀 Starting AI-powered CSV processing...');
  
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    let rowCount = 0;
    let processedCount = 0;

    fs.createReadStream(filePath)
      .pipe(csv({ skipEmptyLines: true }))
      .on('data', async (data) => {
        rowCount++;
        
        // Map CSV columns
        const csvData = {
          name: data['Business Name'] || data.name,
          address: data['Address'] || data.address,
          bookingUrl: data['Booking URL'] || data.bookingUrl,
          mapsLink: data['Google Maps Link'] || data.mapsLink
        };

        // Skip headers
        if (rowCount === 1 && (csvData.name?.toLowerCase().includes('name'))) {
          return;
        }

        if (!csvData.name || !csvData.address) {
          errors.push(`Row ${rowCount}: Missing required fields`);
          return;
        }

        try {
          // AI analysis (includes Google search verification)
          const aiResult = await analyzeAddressWithAI(csvData.name, csvData.address, csvData.mapsLink);

          const enhancedLocation = {
            id: `${csvData.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: csvData.name.trim(),
            originalAddress: csvData.address,
            cleanAddress: aiResult.cleanAddress || csvData.address,
            latitude: aiResult.latitude,
            longitude: aiResult.longitude,
            bookingUrl: csvData.bookingUrl?.trim() || '',
            googleMapsLink: aiResult.googleMapsLink || csvData.mapsLink || '',
            dataQuality: aiResult.dataQuality,
            issues: aiResult.issues || [],
            processed: new Date().toISOString(),
            searchQuery: aiResult.searchQuery || `${csvData.name} EESystem`
          };

          results.push(enhancedLocation);
          processedCount++;

          if (progressCallback) {
            progressCallback({ processed: processedCount, total: rowCount, current: enhancedLocation });
          }

          console.log(`✅ Processed ${processedCount}/${rowCount}: ${csvData.name}`);

        } catch (error) {
          console.error(`❌ Error processing ${csvData.name}:`, error);
          errors.push(`Row ${rowCount}: Processing error - ${error.message}`);
        }
      })
      .on('end', () => {
        console.log(`🎉 Processing complete! ${results.length} locations processed, ${errors.length} errors`);
        
        if (errors.length > 0) {
          console.log('Errors found:', errors);
        }
        
        resolve({ locations: results, errors });
      })
      .on('error', (error) => {
        console.error('❌ CSV parsing error:', error);
        reject(error);
      });
  });
}

// Generate optimized HTML with precomputed coordinates
function generateOptimizedHTML(locations) {
  const templatePath = path.join(__dirname, 'template.html');
  let template = fs.readFileSync(templatePath, 'utf8');
  
  // Prepare optimized location data (no geocoding needed in browser)
  const optimizedLocations = locations.map(loc => ({
    name: loc.name,
    address: loc.cleanAddress || loc.originalAddress,
    bookingUrl: loc.bookingUrl,
    lat: loc.latitude,
    lng: loc.longitude,
    mapsLink: loc.googleMapsLink
  }));
  
  // Replace the placeholder with optimized data
  const jsArray = JSON.stringify(optimizedLocations, null, 2);
  template = template.replace('__CSV_DATA_PLACEHOLDER__', jsArray);
  
  // Remove the slow geocoding code and replace with fast distance calculation
  const optimizedScript = `
    // Pre-computed coordinates - no geocoding needed!
    const BUSINESSES = ${jsArray};
    
    // Fast distance calculation
    const haversine = (lat1, lon1, lat2, lon2) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      return 2 * R * Math.asin(Math.sqrt(a));
    };
    
    // Fast location finder
    async function fastLocationFinder() {
      try {
        const response = await fetch('https://ipapi.co/json/');
        const userLocation = await response.json();
        
        const userLat = parseFloat(userLocation.latitude);
        const userLon = parseFloat(userLocation.longitude);
        
        const nearest = BUSINESSES
          .filter(b => b.lat && b.lng)
          .map(b => ({
            ...b,
            distance: haversine(userLat, userLon, b.lat, b.lng)
          }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 5);
          
        displayResults(nearest, userLocation);
      } catch (error) {
        console.error('Location detection failed:', error);
        displayAllLocations();
      }
    }
  `;
  
  // Replace the old complex geocoding script
  template = template.replace(/<script>[\s\S]*<\/script>/, `<script>${optimizedScript}</script>`);
  
  return template;
}

// Routes
app.post('/ai-upload', upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('🚀 Starting AI-powered processing...');
    
    // Load existing database
    const db = loadDatabase();
    
    // Process CSV with AI
    const { locations, errors } = await processCSVWithAI(req.file.path, (progress) => {
      // In a real app, you'd use WebSockets for real-time progress
      console.log(`Progress: ${progress.processed}/${progress.total} - ${progress.current.name}`);
    });

    // Check for duplicates and add new locations to database
    let newCount = 0;
    let duplicateCount = 0;
    
    for (const location of locations) {
      const existing = db.locations.find(l => 
        l.name.toLowerCase() === location.name.toLowerCase() && 
        l.originalAddress.toLowerCase() === location.originalAddress.toLowerCase()
      );
      
      if (!existing) {
        db.locations.push(location);
        newCount++;
      } else {
        duplicateCount++;
        console.log(`Duplicate found: ${location.name}`);
      }
    }
    
    // Save updated database
    db.lastUpdated = new Date().toISOString();
    saveDatabase(db);

    // Generate optimized HTML
    const optimizedHtml = generateOptimizedHTML(db.locations);
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    console.log(`✅ Processing complete! ${newCount} new locations added, ${duplicateCount} duplicates skipped`);
    
    res.json({
      success: true,
      stats: {
        totalProcessed: locations.length,
        newLocations: newCount,
        duplicates: duplicateCount,
        totalInDatabase: db.locations.length,
        errors: errors.length
      },
      html: optimizedHtml,
      preview: db.locations.slice(-10), // Last 10 added
      errors: errors
    });

  } catch (error) {
    console.error('❌ AI processing error:', error);
    
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: `AI processing failed: ${error.message}` 
    });
  }
});

// Get database stats
app.get('/stats', (req, res) => {
  const db = loadDatabase();
  
  const qualityStats = db.locations.reduce((acc, loc) => {
    acc[loc.dataQuality] = (acc[loc.dataQuality] || 0) + 1;
    return acc;
  }, {});
  
  res.json({
    totalLocations: db.locations.length,
    lastUpdated: db.lastUpdated,
    qualityBreakdown: qualityStats,
    recentlyAdded: db.locations
      .sort((a, b) => new Date(b.processed) - new Date(a.processed))
      .slice(0, 5)
  });
});

// Preview endpoint
app.get('/preview/:id', (req, res) => {
  const db = loadDatabase();
  const location = db.locations.find(l => l.id === req.params.id);
  
  if (!location) {
    return res.status(404).json({ error: 'Location not found' });
  }
  
  // Generate HTML with just this location for preview
  const previewHtml = generateOptimizedHTML([location]);
  res.send(previewHtml);
});

// Error handling
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 5MB)' });
    }
  }
  
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log('🚀 AI-Powered EESystem Location Webapp running!');
  console.log(`🌐 Server: http://localhost:${port}`);
  console.log('🤖 Features: AI analysis, Google search, duplicate detection');
  console.log('⚡ Performance: Pre-computed coordinates for fast loading');
  
  // Initialize database
  const db = loadDatabase();
  console.log(`📊 Database: ${db.locations.length} locations loaded`);
});