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
   Navigate to `http://localhost:3000/ai-interface.html`

4. **Upload Your CSV**
   - Upload CSV with columns: `name`, `address`, `bookingUrl`, `lat`, `lng`, `country`
   - System will geocode addresses and enhance data automatically

5. **Get Your HTML**
   - Copy to clipboard or download the generated location finder
   - Deploy anywhere for fast, responsive location finding

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

## 📁 Files

- `src/app.js` - Application entry point
- `public/ai-interface.html` - Web interface for uploading and managing
- `template.html` - Base template for generated HTML
- `locations_db.json` - Local database (created automatically)

## 🎯 Perfect for

- **EESystem Center Networks** - Manage multiple healing centers
- **Wellness Businesses** - Any location-based wellness services
- **Franchise Operations** - Multi-location business management
- **Healthcare Networks** - Medical or wellness facility finders

---

**Built for EESystem center management and location finding** 🌟
