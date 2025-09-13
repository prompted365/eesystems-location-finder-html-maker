const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const validator = require('validator');
const rateLimit = require('express-rate-limit');
const config = require('../../src/config');

const app = express();
const port = config.PORT;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
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
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed!'), false);
    }
  }
});

// Helper functions
function sanitizeString(str) {
  if (!str) return '';
  return String(str).replace(/[<>\"'&]/g, function(match) {
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

// Process CSV and generate HTML
async function processCsvData(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    let rowCount = 0;

    fs.createReadStream(filePath)
      .pipe(csv({
        skipEmptyLines: true
      }))
      .on('data', (data) => {
        rowCount++;
        
        // Map CSV columns to our expected format
        const csvData = {
          name: data['Business Name'] || data.name,
          address: data['Address'] || data.address,
          bookingUrl: data['Booking URL'] || data.bookingUrl,
          mapsLink: data['Google Maps Link'] || data.mapsLink
        };

        // Skip if this looks like a header row
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
          bookingUrl: ensureHttps(csvData.bookingUrl.trim())
        };

        // Optional: Store maps link for future use if provided
        if (csvData.mapsLink && csvData.mapsLink.trim()) {
          // Clean up Google Maps URLs (they can be very long)
          let mapsUrl = csvData.mapsLink.trim();
          // If it's a valid URL, keep it; otherwise skip validation
          if (mapsUrl.startsWith('http')) {
            cleanData.mapsLink = mapsUrl;
          }
        }

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

// Generate HTML from template
function generateHtml(csvData) {
  const templatePath = path.join(__dirname, 'template.html');
  const template = fs.readFileSync(templatePath, 'utf8');
  
  // Convert CSV data to JavaScript array format
  const jsArray = JSON.stringify(csvData, null, 2);
  
  // Replace placeholder with actual data
  const finalHtml = template.replace('__CSV_DATA_PLACEHOLDER__', jsArray);
  
  return finalHtml;
}

// Routes
app.post('/upload', upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvData = await processCsvData(req.file.path);
    
    if (csvData.length > 500) {
      return res.status(400).json({ error: 'Too many locations (max 500 allowed)' });
    }

    const generatedHtml = generateHtml(csvData);
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      locationCount: csvData.length,
      html: generatedHtml,
      preview: csvData.slice(0, 5) // First 5 locations for preview
    });

  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    console.error('CSV processing error:', error.message);
    res.status(400).json({ 
      error: error.message || 'Failed to process CSV file' 
    });
  }
});

// Serve sample CSV file
app.get('/sample.csv', (req, res) => {
  const sampleCsv = `Business Name,Address,Booking URL,Google Maps Link
Sample EESystem Center,123 Main St, Anytown, ST 12345, USA,https://ee-system.com/sample-center,https://maps.google.com/sample
Another Center,456 Oak Ave, Another City, ST 67890, USA,https://ee-system.com/another-center,https://maps.google.com/another`;
  
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

app.listen(port, () => {
  console.log(`EESystem Location Webapp running at http://localhost:${port}`);
  console.log('Upload CSV files to generate custom EESystem location finder HTML!');
});