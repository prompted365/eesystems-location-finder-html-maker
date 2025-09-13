const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const validator = require('validator');

// Simple slug generator for stable ids
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

// Attempt to extract latitude and longitude from Google Maps URLs
function parseLatLng(url) {
  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  }
  const dMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (dMatch) {
    return { lat: parseFloat(dMatch[1]), lng: parseFloat(dMatch[2]) };
  }
  return { lat: null, lng: null };
}

// Basic country detection from address text
function detectCountryCode(address) {
  const map = {
    'australia': 'AU',
    'canada': 'CA',
    'united kingdom': 'GB',
    'uk': 'GB',
    'england': 'GB',
    'scotland': 'GB',
    'ireland': 'IE',
    'mexico': 'MX',
    'puerto rico': 'PR'
  };
  const lower = address.toLowerCase();
  for (const [name, code] of Object.entries(map)) {
    if (lower.includes(name)) return code;
  }
  return 'US';
}

// Naive address parser: assumes "street, city region postal"
function parseAddress(address) {
  let street = address.trim();
  let city = '';
  let region = '';
  let postal = '';
  if (address.includes(',')) {
    const [s, rest] = address.split(',', 2);
    street = s.trim();
    const tokens = rest.trim().split(/\s+/);
    if (tokens.length >= 2) {
      region = tokens[tokens.length - 2];
      postal = tokens[tokens.length - 1];
      city = tokens.slice(0, tokens.length - 2).join(' ');
    } else {
      city = rest.trim();
    }
  }
  return { street, city, region, postal };
}

const INPUT = path.join(__dirname, '..', 'ee-systems-locations.csv');
const OUTPUT = path.join(__dirname, '..', 'data', 'locations.json');

const rows = [];
fs.createReadStream(INPUT)
  .pipe(csv())
  .on('data', (row) => {
    const name = (row['Business Name'] || '').trim();
    const address = (row['Address'] || '').trim();
    const bookingUrl = (row['Booking URL'] || '').trim();
    const mapUrl = (row['Google Maps Link'] || '').trim();

    if (!name) return;
    if (bookingUrl && !validator.isURL(bookingUrl)) return;
    if (mapUrl && !validator.isURL(mapUrl)) return;

    const id = slugify(name);
    const { street, city, region, postal } = parseAddress(address);
    const { lat, lng } = parseLatLng(mapUrl);
    const country_code = detectCountryCode(address);

    rows.push({
      id,
      name,
      street,
      city,
      region,
      postal,
      country_code,
      booking_url: bookingUrl || null,
      map_url: mapUrl || null,
      lat,
      lng
    });
  })
  .on('end', () => {
    // de-duplicate by id
    const seen = new Set();
    const deduped = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      deduped.push(r);
    }
    deduped.sort((a, b) => a.name.localeCompare(b.name));
    const output = {
      locations: deduped,
      lastUpdated: new Date().toISOString(),
      version: '2.0'
    };
    fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
    console.log(`Wrote ${deduped.length} locations to ${OUTPUT}`);
  });
