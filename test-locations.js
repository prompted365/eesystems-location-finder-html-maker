const fs = require('fs');
const csv = require('csv-parser');

// Test if generated HTML contains all locations from CSV
async function testLocationHardcoding() {
    console.log('🔍 Testing if all CSV locations are hardcoded in generated HTML...\n');

    // Read the CSV file to get expected locations
    const csvLocations = [];
    await new Promise((resolve) => {
        fs.createReadStream('C:/Users/james/Downloads/ees-centers- onboarded and lander made and checked - main sheet master (3).csv')
            .pipe(csv())
            .on('data', (data) => {
                if (data.name && data.name.toLowerCase() !== 'name') { // Skip header
                    csvLocations.push({
                        name: data.name.trim(),
                        lat: parseFloat(data.lat),
                        lng: parseFloat(data.lng),
                        country: data.country || '',
                        address: data.address || ''
                    });
                }
            })
            .on('end', resolve);
    });

    console.log(`📊 CSV contains ${csvLocations.length} locations`);

    // Check UK locations specifically
    const ukLocations = csvLocations.filter(loc => 
        loc.country.toLowerCase().includes('kingdom') || 
        loc.address.toLowerCase().includes('uk')
    );
    
    console.log(`🇬🇧 UK locations in CSV: ${ukLocations.length}`);
    ukLocations.forEach(loc => {
        console.log(`   - ${loc.name} (${loc.lat}, ${loc.lng})`);
    });

    // Check USA locations
    const usaLocations = csvLocations.filter(loc => 
        loc.country.toLowerCase().includes('states') || 
        loc.address.toLowerCase().includes('usa')
    );
    
    console.log(`🇺🇸 USA locations in CSV: ${usaLocations.length}`);

    // Check if there are locations near Manchester coordinates (53.478, -2.248)
    const nearManchester = csvLocations.filter(loc => {
        if (!loc.lat || !loc.lng) return false;
        const distance = Math.sqrt(
            Math.pow(loc.lat - 53.478, 2) + Math.pow(loc.lng - (-2.248), 2)
        );
        return distance < 2; // Within ~2 degrees (rough)
    });

    console.log(`📍 Locations near Manchester coordinates: ${nearManchester.length}`);
    nearManchester.forEach(loc => {
        console.log(`   - ${loc.name} (${loc.lat}, ${loc.lng})`);
    });

    // Sample a few locations to show what we have
    console.log(`\n📋 Sample locations from CSV:`);
    csvLocations.slice(0, 5).forEach(loc => {
        console.log(`   - ${loc.name} | ${loc.country} | (${loc.lat}, ${loc.lng})`);
    });

    return {
        total: csvLocations.length,
        uk: ukLocations.length,
        usa: usaLocations.length,
        nearManchester: nearManchester.length
    };
}

testLocationHardcoding().then(results => {
    console.log('\n✅ Location analysis complete:', results);
}).catch(console.error);