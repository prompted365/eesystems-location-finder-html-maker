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

// Proper geocoding using Nominatim (like the original)
async function getCoordinates(address) {
  try {
    console.log(`🌍 Geocoding: ${address}`);
    
    // First check cache
    const cacheKey = `geocode_${address.toLowerCase()}`;
    
    // Use Nominatim geocoding API (same as original)
    await new Promise(r => setTimeout(r, 200)); // Rate limiting
    
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(address)}`;
    const response = await fetch(url, {
      headers: { 'Accept-Language': 'en' }
    });
    
    if (!response.ok) {
      console.log(`❌ Geocoding failed for ${address}: HTTP ${response.status}`);
      return { lat: null, lng: null, quality: 'error' };
    }
    
    const results = await response.json();
    const hit = results && results[0];
    
    if (!hit) {
      console.log(`❌ No geocoding results for: ${address}`);
      return { lat: null, lng: null, quality: 'not_found' };
    }
    
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { lat: null, lng: null, quality: 'invalid' };
    }
    
    console.log(`✅ Geocoded ${address} to: ${lat}, ${lng}`);
    return { lat, lng, quality: 'excellent' };
    
  } catch (error) {
    console.error(`❌ Geocoding error for ${address}:`, error);
    return { lat: null, lng: null, quality: 'error' };
  }
}

// Generate Google Maps link
function generateMapsLink(businessName, address) {
  const searchTerm = `${businessName} ${address}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchTerm)}`;
}

// Fast CSV processing 
async function processCSVFast(filePath) {
  console.log('🚀 Starting FAST CSV processing...');
  
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    let rowCount = 0;

    fs.createReadStream(filePath)
      .pipe(csv({ skipEmptyLines: true }))
      .on('data', async (data) => {
        rowCount++;
        
        // Map CSV columns (handle different possible column names)
        const csvData = {
          name: data['name'] || data['Business Name'] || data.name,
          address: data['address'] || data['Address'] || data.address,
          bookingUrl: data['bookingUrl'] || data['Booking URL'] || data.bookingUrl,
          lat: data['lat'] || null,
          lng: data['lng'] || null,
          country: data['country'] || null
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
          // Get coordinates if not provided
          let coordinates = { lat: csvData.lat, lng: csvData.lng, quality: 'provided' };
          if (!csvData.lat || !csvData.lng) {
            coordinates = await getCoordinates(csvData.address);
          }

          const enhancedLocation = {
            id: `${csvData.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: csvData.name.trim(),
            address: csvData.address.trim(),
            cleanAddress: csvData.address.trim(),
            originalAddress: csvData.address.trim(),
            latitude: coordinates.lat,
            longitude: coordinates.lng,
            bookingUrl: csvData.bookingUrl?.trim() || '',
            googleMapsLink: generateMapsLink(csvData.name, csvData.address),
            dataQuality: coordinates.quality === 'provided' ? 'excellent' : 
                        coordinates.quality === 'state' ? 'good' : 
                        coordinates.quality === 'country' ? 'fair' : 'poor',
            issues: [], // Empty array for compatibility
            processed: new Date().toISOString(),
            country: csvData.country || 'unknown'
          };

          results.push(enhancedLocation);
          console.log(`✅ Processed ${rowCount}: ${csvData.name} (${coordinates.quality})`);

        } catch (error) {
          console.error(`❌ Error processing ${csvData.name}:`, error);
          errors.push(`Row ${rowCount}: Processing error - ${error.message}`);
        }
      })
      .on('end', () => {
        console.log(`🎉 Processing complete! ${results.length} locations processed, ${errors.length} errors`);
        resolve({ locations: results, errors });
      })
      .on('error', (error) => {
        console.error('❌ CSV parsing error:', error);
        reject(error);
      });
  });
}

// Generate optimized HTML with precomputed coordinates (using original style)
function generateOptimizedHTML(locations) {
  // Prepare optimized location data (matching original format)
  const optimizedLocations = locations.map(loc => ({
    name: loc.name,
    address: loc.address,
    bookingUrl: loc.bookingUrl,
    lat: loc.latitude,
    lng: loc.longitude
  }));
  
  // Use the original high-quality template
  const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>EESystem Center Finder</title>
<meta name="referrer" content="no-referrer">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Poppins:wght@600;700&display=swap" rel="stylesheet">

<style>
:root{
  --bg:#ffffff; --surface:#f5f8fc; --muted:#44506a; --text:#000; --heading:#0a1930;
  --accentA:#00e5ff; --accentB:#17ff9e; --border:#e8eef6; --error:#b00020;
  --radius:24px; --shadow:0 14px 36px rgba(14,30,58,.10);
}
*{box-sizing:border-box} html,body{height:100%}
body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial;background:var(--bg);color:var(--text)}
.wrapper{max-width:1140px;margin:20px auto;padding:0 14px}
.locator{padding:22px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}

/* HERO */
.hero{margin:10px 0 18px;padding:36px 28px;border-radius:28px;background:#fff;border:1px solid var(--border);text-align:center}
.hero h2{margin:0 0 12px;font:800 2.25rem/1.18 Poppins,Inter,sans-serif;color:var(--heading)}
.hero p{margin:0 0 20px;color:#26354f;font-size:1.02rem}
.small-note{font-size:.66rem;color:#0f5132;margin-top:10px}

/* RESULTS */
.error{color:var(--error);margin-top:8px;display:none}
.result{margin-top:14px;padding:22px 18px;border-radius:22px;background:#fff;border:1px solid var(--border);box-shadow:var(--shadow);display:none}
.result h2{margin:0 0 8px;font:800 1.5rem/1.22 Poppins,Inter,sans-serif;color:var(--heading)}
.result .sub{margin:0 0 6px;color:#3a4a67;font-size:1rem}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:10px}
.card{padding:16px;border-radius:18px;background:#fff;border:1px solid var(--border);display:flex;flex-direction:column;gap:10px;box-shadow:0 6px 18px rgba(11,29,60,.06);transition:transform .12s ease,box-shadow .18s ease,border-color .18s ease}
.card:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(11,29,60,.10);border-color:#dfe8f5}
.card h3{margin:0;font:700 1.05rem/1.26 Poppins,Inter,sans-serif;color:#0f172a}
.meta{font-size:.92rem;color:#53627d}
.meta .badge{display:inline-block;margin-left:8px;padding:4px 10px;border-radius:999px;background:linear-gradient(90deg,rgba(0,229,255,.18),rgba(23,255,158,.18));border:1px solid rgba(0,229,255,.38);font-size:.78rem;color:#00343b;font-weight:800}
.card .actions{display:flex;align-items:center;gap:12px;margin-top:2px}
.btn{padding:13px 18px;border-radius:999px;border:1px solid var(--border);font-weight:800;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;color:#001014;transition:transform .08s ease,filter .18s ease,box-shadow .18s ease}
.btn--primary{background:linear-gradient(90deg,var(--accentA),var(--accentB));border:0;box-shadow:0 10px 22px rgba(0,192,160,.24)}
.btn:hover{filter:saturate(1.06) brightness(1.02);transform:translateY(-1px)}
.btn:active{transform:translateY(0)} .btn[disabled]{opacity:.6;cursor:not-allowed}
.map-link{font-size:.95rem;color:#0a6f75;text-decoration:underline}
.map-link:hover{color:#065a5f}

/* Redirect overlay */
.modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(8,14,22,.55);backdrop-filter:saturate(120%) blur(6px);z-index:9999}
.sheet{max-width:760px;width:92%;background:#fff;border-radius:26px;border:1px solid var(--border);box-shadow:var(--shadow);padding:32px 26px;text-align:center}
.sheet h3{margin:0 0 12px;font:800 1.6rem/1.28 Poppins,Inter,sans-serif;color:#081225}
.sheet p{margin:0 0 14px;color:#243148;font-size:1.06rem}
.progress{height:12px;background:#fff;border:1px solid var(--border);border-radius:999px;overflow:hidden;margin:14px auto 0;max-width:520px}
.progress .bar{height:100%;width:0%;background:linear-gradient(90deg,var(--accentA),var(--accentB));transition:width .25s ease}
.count{margin-top:10px;color:#0b3b2b;font-weight:800;font-size:1.05rem}
.sheet .row{display:flex;gap:10px;justify-content:center;margin-top:14px}
.sheet .go-now{padding:12px 16px;border-radius:12px;border:0;background:linear-gradient(90deg,var(--accentA),var(--accentB));font-weight:800;cursor:pointer}

/* Responsive */
@media (max-width:980px){.cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}}
@media (max-width:640px){
  .hero{padding:26px 18px}
  .hero h2{font-size:1.85rem}
  .cards{grid-template-columns:1fr;gap:12px}
  .result{padding:18px 14px}
}
</style>
</head>
<body>
<div class="wrapper">
  <div class="locator" id="ees-widget">

    <!-- HERO -->
    <section class="hero" aria-labelledby="heroTitle">
      <h2 id="heroTitle">Let's find your closest EESystem center</h2>
      <p>We'll show nearby centres automatically based on your area.</p>
      <p class="small-note"><strong>Privacy:</strong> we don't save your location. Matching happens in your browser.</p>
    </section>

    <!-- AUTO-GEO RESULTS -->
    <div class="error" id="errorTop" role="alert"></div>
    <section class="result" id="resultTop" aria-live="polite" aria-atomic="true">
      <h2 id="titleTop">Nearest centres</h2>
      <p class="sub">Click <strong>Book Now</strong> to be directed to your EESystem Centre's booking page.</p>
      <div id="cardsTop" class="cards"></div>
    </section>

  </div>
</div>

<!-- Redirect overlay -->
<div class="modal" id="redirectOverlay" aria-live="polite" aria-modal="true" role="dialog">
  <div class="sheet">
    <h3 id="redirectTitle">Directing you to the booking page…</h3>
    <p>Please scroll down on the next page to find the calendar.</p>
    <p>Heading to <strong id="redirectName">your centre</strong> — where you can learn more and book your first life-changing appointment!</p>
    <div class="progress"><div class="bar" id="redirBar"></div></div>
    <div class="count">Opening in <span id="secLeft">10</span> sec</div>
    <div class="row">
      <button id="goNowBtn" class="go-now" style="display:none">OK, take me there now</button>
    </div>
  </div>
</div>

<script>
(function(){
  'use strict';

  /* ===== Helpers ===== */
  const qs=s=>document.querySelector(s);
  const toRad=v=>v*Math.PI/180;
  const hav=(a,b)=>{const R=6371,dLat=toRad(b.lat-a.lat),dLon=toRad(b.lng-a.lng);const h=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h))};
  const fmtMi = km => ((km*0.621371)<100?(km*0.621371).toFixed(1):(km*0.621371).toFixed(0))+' mi';
  const ensureHttps=u=>{if(!u)return '#';u=String(u).trim();if(!/^https?:\\/\\//i.test(u))u='https://'+u.replace(/^\/+/,'');return u;}
  const mapsUrl=(lat,lng,address)=> (Number.isFinite(lat)&&Number.isFinite(lng))
      ? \`https://www.google.com/maps/search/?api=1&query=\${lat},\${lng}\`
      : \`https://www.google.com/maps/search/?api=1&query=\${encodeURIComponent(address||'EESystem Center')}\`;
  const norm=(s)=>String(s||'').trim().toLowerCase();
  const canonCountry=(c)=>{
    c=norm(c);
    if(!c) return '';
    if(['usa','u.s.a.','united states','united states of america','puerto rico','us'].includes(c)) return 'united states';
    if(['uk','united kingdom','england','scotland','wales','northern ireland','gb','great britain'].includes(c)) return 'united kingdom';
    return c;
  };

  /** Forward UTMs + our geo params to booking URL */
  const COPY_THROUGH = ['utm_source','utm_medium','utm_campaign','utm_adset','utm_ad','placement','site_source_name','fbclid'];
  function decorateUrl(url, extra){
    const u = new URL(ensureHttps(url));
    const curr = new URL(location.href);
    COPY_THROUGH.forEach(k => { const v = curr.searchParams.get(k); if(v) u.searchParams.set(k,v); });
    Object.entries(extra||{}).forEach(([k,v])=>{ if(v!==undefined && v!==null && String(v).length) u.searchParams.set(k,String(v)); });
    return u.toString();
  }

  /* ===== Raw centre list (with precise coordinates) ===== */
  const RAW=${JSON.stringify(optimizedLocations, null, 2)};

  function parseAddress(addr){
    let city='', st='', country='';
    const parts=String(addr||'').split(',').map(s=>s.trim());
    // country from tail
    if(/United Kingdom|UK/i.test(addr)) country='united kingdom';
    else if(/USA|United States|PR\\b/i.test(addr)) country='united states';
    else if(/Canada/i.test(addr)) country='canada';
    else if(/Australia/i.test(addr)) country='australia';
    else if(/Netherlands/i.test(addr)) country='netherlands';
    else if(/Ireland/i.test(addr)) country='ireland';
    else if(/France/i.test(addr)) country='france';
    else if(/Italy/i.test(addr)) country='italy';
    else if(/Denmark/i.test(addr)) country='denmark';
    else if(/Norway/i.test(addr)) country='norway';
    else if(/Philippines/i.test(addr)) country='philippines';

    // state guess
    const m1=addr.match(/,\\s*([A-Z]{2})\\s+\\d{4,5}/); if(m1) st=m1[1];
    else { const m2=addr.match(/,\\s*([A-Z]{2})(?:,|\\s|$)/); if(m2) st=m2[1]; }

    // city guess: take first segment's last word if looks like a place
    const first=parts[0]||'';
    const cleaned=first.replace(/\\d+|#\\d+|Suite|Unit|Rd|Road|St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive/gi,'').trim();
    if(cleaned && !/\\d/.test(cleaned)) city=cleaned.split(/\\s+/).slice(-1).join(' ')||cleaned;

    if(!country && st) country='united states';
    return {city, stateAbbr:st, country, lat:null, lng:null};
  }

  const BUSINESSES = RAW.map(r=>({ ...parseAddress(r.address||''), name:r.name, address:r.address, bookingUrl:ensureHttps(r.bookingUrl), lat:r.lat, lng:r.lng }));

  /* ===== UI rendering ===== */
  function makeCards(list){
    const wrap=document.getElementById('cardsTop'); wrap.innerHTML='';
    list.forEach((c,i)=>{
      const card=document.createElement('div'); card.className='card';
      const h3=document.createElement('h3'); h3.textContent=c.name; card.appendChild(h3);
      const meta=document.createElement('div'); meta.className='meta';
      meta.innerHTML=\`\${c.address||''}\${(typeof c._d==='number')?\` <span class="badge">\${i===0?'Closest — ':''}\${fmtMi(c._d)}</span>\`:''}\`;
      card.appendChild(meta);
      const row=document.createElement('div'); row.className='actions';
      const book=document.createElement('a'); book.href="#"; book.className='btn btn--primary book-btn';
      book.dataset.url=c.bookingUrl; book.dataset.name=c.name; book.dataset.lat=c.lat||''; book.dataset.lng=c.lng||''; book.textContent='Book Now';
      const map=document.createElement('a'); map.href=mapsUrl(c.lat,c.lng,c.address); map.target="_blank"; map.rel="noopener noreferrer"; map.className='map-link'; map.textContent='See on map';
      row.appendChild(book); row.appendChild(map); card.appendChild(row);
      wrap.appendChild(card);
    });
    wireBookLinks();
  }

  /* ===== IP Geo + same-country top 5 ===== */
  async function ipGeo(){
    try{const r=await fetch("https://ipapi.co/json/"); if(!r.ok) throw 0; const j=await r.json();
      return {lat:+j.latitude,lng:+j.longitude,city:j.city||"",region:j.region||"",country:canonCountry(j.country_name||""),postal:j.postal||""};
    }catch{const r2=await fetch("https://ipwho.is/"); const j2=await r2.json();
      return {lat:+j2.latitude,lng:+j2.longitude,city:j2.city||"",region:j2.region||"",country:canonCountry(j2.country||""),postal:j2.postal||""};}
  }

  function roughNearest(origin, list){
    return list.filter(b=>Number.isFinite(b.lat)&&Number.isFinite(b.lng))
               .map(b=>({...b,_d: hav(origin,{lat:b.lat,lng:b.lng})}))
               .sort((a,b)=>a._d-b._d);
  }

  (async () => {
    const errEl=qs('#errorTop'); const sec=qs('#resultTop'); const title=qs('#titleTop');
    try{
      console.log('Starting location finder...');
      console.log('Total businesses loaded:', BUSINESSES.length);
      
      const loc = await ipGeo();
      lastGeo = loc;
      console.log('User location detected:', loc);

      // Show where it searched
      if (title) {
        const where = [loc.city, loc.region].filter(Boolean).join(', ') || (loc.country ? loc.country.replace(/\\b\\w/g,m=>m.toUpperCase()) : 'your area');
        title.innerHTML = \`Nearest centres <span style="font-weight:600;color:#50607a;font-size:.95rem">(\${where})</span>\`;
      }

      // Same-country only
      const cc = canonCountry(loc.country);
      console.log('Looking for businesses in country:', cc);
      let same = BUSINESSES.filter(b => canonCountry(b.country) === cc);
      console.log('Found businesses in same country:', same.length);

      // If still nothing → show friendly message and exit
      if(!same.length){
        sec.style.display='none';
        errEl.textContent='No locations found in your country. Please check back soon as we are expanding globally!';
        errEl.style.display='block';
        return;
      }

      // Compute distance for all locations, take top 5
      const ranked = roughNearest({lat:loc.lat,lng:loc.lng}, same).slice(0,5);

      if(!ranked.length){
        sec.style.display='none';
        errEl.textContent='No locations found, This might be a error, but do not worry, we will be sending you a facebook message shortly with a suggestion!';
        errEl.style.display='block';
        return;
      }

      makeCards(ranked);
      sec.style.display='block';
    }catch(e){
      console.error(e);
      sec.style.display='none';
      errEl.textContent='No locations found, This might be a error, but do not worry, we will be sending you a facebook message shortly with a suggestion!';
      errEl.style.display='block';
    }
  })();

  /* ===== Book flow (overlay + forwarding params) ===== */
  let lastGeo=null;
  const overlay=qs('#redirectOverlay'), bar=qs('#redirBar'), rname=qs('#redirectName'), secLeftEl=qs('#secLeft'), goNowBtn=qs('#goNowBtn');
  let countdownTimer=null, targetUrl='#', appearTimer=null;

  function wireBookLinks(){
    document.querySelectorAll('a.book-btn').forEach(a=>{
      a.removeEventListener('click', onBook, true);
      a.addEventListener('click', onBook, true);
    });
  }

  function onBook(e){
    e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation();
    const baseUrl = e.currentTarget.dataset.url;
    const name = e.currentTarget.dataset.name || 'your centre';
    const cLat = parseFloat(e.currentTarget.dataset.lat);
    const cLng = parseFloat(e.currentTarget.dataset.lng);

    let distMi = '';
    if(lastGeo && Number.isFinite(cLat) && Number.isFinite(cLng)){
      const dKm = hav({lat:lastGeo.lat,lng:lastGeo.lng}, {lat:cLat,lng:cLng});
      distMi = (dKm*0.621371).toFixed(2);
    }

    const params = {
      utm_client_city: lastGeo?.city || '',
      utm_client_region: lastGeo?.region || '',
      utm_client_country: lastGeo?.country || '',
      utm_client_postal: lastGeo?.postal || '',
      utm_client_lat: Number.isFinite(lastGeo?.lat) ? Number(lastGeo.lat).toFixed(6) : '',
      utm_client_lng: Number.isFinite(lastGeo?.lng) ? Number(lastGeo.lng).toFixed(6) : '',
      utm_nearest_center: name,
      utm_nearest_center_distance_mi: distMi,
      utm_geo_match_within_10mi: distMi ? (parseFloat(distMi) <= 10 ? 'true' : 'false') : ''
    };

    const finalUrl = decorateUrl(baseUrl, params);
    if(!finalUrl) return;

    targetUrl = finalUrl;
    rname.textContent=name; overlay.style.display='flex'; bar.style.width='0%'; secLeftEl.textContent='10';
    goNowBtn.style.display='none'; goNowBtn.disabled=true;
    appearTimer=setTimeout(()=>{ goNowBtn.style.display='inline-block'; goNowBtn.disabled=false; goNowBtn.focus(); },2000);
    const total=10_000, step=100; let elapsed=0;
    countdownTimer=setInterval(()=>{ elapsed+=step; bar.style.width=Math.min(100,(elapsed/total)*100)+'%'; secLeftEl.textContent=String(Math.max(0,Math.ceil((total-elapsed)/1000))); if(elapsed>=total){ clearInterval(countdownTimer); proceed(); } },step);
  }
  function proceed(){ window.location.href=targetUrl; }
  goNowBtn.addEventListener('click', proceed);
  window.addEventListener('keydown',e=>{ if(e.key==='Escape' && overlay.style.display==='flex'){ overlay.style.display='none'; clearInterval(countdownTimer); clearTimeout(appearTimer);} });

})();
</script>
</body>
</html>`;
  
  return htmlTemplate;
}

// Routes
app.post('/upload', upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('🚀 Starting FAST processing...');
    
    const csvResult = await processCSVFast(req.file.path);
    const csvData = csvResult.locations;
    
    if (csvData.length > 500) {
      return res.status(400).json({ error: 'Too many locations (max 500 allowed)' });
    }

    const generatedHtml = generateOptimizedHTML(csvData);
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      locationCount: csvData.length,
      html: generatedHtml,
      preview: csvData.slice(0, 5)
    });

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    console.error('CSV processing error:', error.message);
    res.status(400).json({ 
      error: error.message || 'Failed to process CSV file' 
    });
  }
});

app.post('/ai-upload', upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('🚀 Starting FAST processing...');
    
    // Load existing database
    const db = loadDatabase();
    
    // Process CSV quickly
    const { locations, errors } = await processCSVFast(req.file.path);

    // Check for duplicates and add new locations to database
    let newCount = 0;
    let duplicateCount = 0;
    
    for (const location of locations) {
      const existing = db.locations.find(l => 
        l.name.toLowerCase() === location.name.toLowerCase() && 
        l.address.toLowerCase() === location.address.toLowerCase()
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
    console.error('❌ Processing error:', error);
    
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: `Processing failed: ${error.message}` 
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
// Favicon route to prevent 404 errors
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

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
  console.log('🚀 FAST EESystem Location Webapp running!');
  console.log(`🌐 Server: http://localhost:${port}`);
  console.log('⚡ Features: Fast processing, coordinate lookup, duplicate detection');
  console.log('🎯 No AI delays - instant results!');
  
  // Initialize database
  const db = loadDatabase();
  console.log(`📊 Database: ${db.locations.length} locations loaded`);
});