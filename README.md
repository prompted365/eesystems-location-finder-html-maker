# EESystem Location Webapp

🌟 **AI-Powered EESystem Location Finder Generator** 

A sophisticated web application that processes CSV files containing EESystem center data and generates optimized, fast-loading location finder HTML pages.

## ✨ Features

- **🤖 AI-Enhanced Processing** - OpenAI GPT-4 powered address analysis
- **📍 Precise Geocoding** - Uses Nominatim API for exact coordinates  
- **🚀 Fast Performance** - Pre-computed coordinates eliminate slow browser geocoding
- **🎨 Beautiful UI** - Professional design with responsive layout
- **📋 Clipboard Integration** - Copy generated HTML directly to clipboard
- **🌍 Global Support** - Handles locations worldwide with country-specific matching
- **🔄 Duplicate Prevention** - Smart database management prevents duplicates
- **⚡ Live Preview** - Test your location finder instantly

## 🚀 Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Server**
   ```bash
   node src/app.js
   ```

3. **Open Web Interface**
   Navigate to `http://localhost:3000/`

4. **Upload Your CSV**
   - Upload CSV with columns: `name`, `address`, `bookingUrl`, `lat`, `lng`, `country`
   - System will geocode addresses and enhance data automatically

5. **Get Your HTML**
   - Copy to clipboard or download the generated location finder
   - Deploy anywhere for fast, responsive location finding

## 🧹 CSV QA Script

Before committing updated location data, run the quality assurance script to
trim fields, validate URLs and regenerate the canonical JSON database:

```bash
node scripts/qa-csv.js
```

The script writes the cleaned results to `data/locations.json`. The legacy
`database.json` file now lives under `deprecated/data/` for historical
reference.

## 🧪 Testing & TDD

This project uses a test-driven development workflow. Write failing tests first in the appropriate layer and then implement your feature.

Run the full test suite:

```bash
npm test
```

Run individual layers:

```bash
npm run test:unit
npm run test:smoke
npm run test:e2e
```

## 📊 CSV Format

Your CSV should include these columns:
```csv
name,address,bookingUrl,lat,lng,country
"Center Name","123 Main St, City, State","https://example.com/book",,,"USA"
```

- `lat` and `lng` are optional - will be geocoded automatically
- `country` helps with faster processing but is also detected automatically

## 🛠 Technical Features

- **Node.js + Express** backend
- **Nominatim geocoding** for precise coordinates
- **JSON database** for efficient duplicate management
- **Rate limiting** and security features
- **Professional HTML/CSS/JS** output
- **Responsive design** works on all devices

## 🌟 Generated Location Finder Features

The generated HTML includes:
- **Automatic user location detection**
- **Distance-based sorting** 
- **Country-specific filtering**
- **Beautiful card-based layout**
- **Direct booking links**
- **Google Maps integration**
- **Mobile responsive design**
- **Fast loading performance**

## 🔧 Configuration

- Modify geocoding settings in `src/app.js`
- Customize HTML template in the `generateOptimizedHTML` function
- Adjust rate limiting and security settings as needed

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Node environment |
| `RATE_LIMIT_MAX` | `100` | Max requests per 15‑minute window |
| `DATA_STORE` | `json` | Backend store (`json`, `postgres`, `redis`) |
| `MODE` | `basic` | Application mode |
| `GEOCODER` | `nominatim` | Geocoding service |
| `ENABLE_ADMIN` | `false` | Enable admin routes |
| `ADMIN_TOKEN` | – | Token required when admin mode enabled |
| `USE_LOCAL_DB` | `false` | Force local JSON database |
| `DATABASE_URL` | – | PostgreSQL connection string |
| `REDIS_URL` | – | Redis connection string (geocode cache defaults to `redis://localhost:6379` if unset) |
| `NOMINATIM_UA` | – | User-Agent for Nominatim requests |
| `NOMINATIM_EMAIL` | – | Contact email sent with Nominatim requests |

## 🔐 Admin Mode (Local Testing)

The admin dashboards are disabled by default and not served in production. To enable them locally:

1. Set the environment variables:
   ```bash
   ENABLE_ADMIN=true
   ADMIN_TOKEN=your-secret-token
   ```
2. Start the server with these variables:
   ```bash
   ENABLE_ADMIN=true ADMIN_TOKEN=your-secret-token node src/app.js
   ```
3. Access the dashboards:
   - `http://localhost:3000/admin?token=your-secret-token`
   - `http://localhost:3000/ai-interface?token=your-secret-token`

## 📁 Files

- `src/app.js` - Application entry point
- `template.html` - Base template for generated HTML
- `data/locations.json` - Canonical location database

## 🎯 Perfect for

- **EESystem Center Networks** - Manage multiple healing centers
- **Wellness Businesses** - Any location-based wellness services
- **Franchise Operations** - Multi-location business management
- **Healthcare Networks** - Medical or wellness facility finders

---

**Built for EESystem center management and location finding** 🌟
