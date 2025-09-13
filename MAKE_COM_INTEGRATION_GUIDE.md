# Make.com Integration Guide for EESystem Location Webapp

## 🚀 Complete Setup Guide for Automatic Google Sheets to Database Sync

### **📋 Overview**

This guide shows how to set up Make.com to automatically sync your Google Sheets with the EESystem location database. When you update your Google Sheet, Make.com will instantly push changes to your webapp.

---

## **🔧 Make.com Scenario Configuration**

### **Step 1: Create New Scenario**
1. Log into Make.com
2. Create new scenario
3. Name it: "EESystem Location Sync"

### **Step 2: Add Google Sheets Trigger**
1. Add "Google Sheets" module
2. Choose "Watch Changes"
3. Connect your Google account
4. Select your spreadsheet: "ees-centers- onboarded and lander made and checked - main sheet master"
5. Choose the worksheet with your location data

### **Step 3: Configure Webhook Module**
1. Add "HTTP" module
2. Choose "Make a request"
3. Configure as follows:

**URL:** `https://eesystems-location-finder-html-maker.onrender.com/webhook/make-com`
**Method:** `POST`
**Headers:**
```json
{
  "Content-Type": "application/json"
}
```

**Body Type:** Raw
**Content Type:** JSON (application/json)

**Body (JSON):**
```json
{
  "name": "{{1.name}}",
  "address": "{{1.address}}",
  "bookingUrl": "{{1.bookingUrl}}",
  "lat": "{{1.lat}}",
  "lng": "{{1.lng}}",
  "country": "{{1.country}}",
  "googlemaps": "{{1.googlemaps}}"
}
```

---

## **📊 Google Sheets Column Mapping**

Your Google Sheet must have these exact column headers:

| Column | Make.com Variable | Description |
|--------|------------------|-------------|
| name | {{1.name}} | Center name |
| address | {{1.address}} | Full address |
| bookingUrl | {{1.bookingUrl}} | EE-system booking link |
| lat | {{1.lat}} | Latitude coordinate |
| lng | {{1.lng}} | Longitude coordinate |
| country | {{1.country}} | Country name |
| googlemaps | {{1.googlemaps}} | Google Maps link (optional) |

---

## **🔗 Webhook Details**

### **Webhook URL (LIVE):**
```
https://eesystems-location-finder-html-maker.onrender.com/webhook/make-com
```

### **Test URL:**
```
https://eesystems-location-finder-html-maker.onrender.com/webhook/make-com/test
```

### **Expected Data Format:**

**Single Location Update:**
```json
{
  "name": "ArkLaTex EEnergy Healing Center",
  "address": "4059 Summerhill Rd, Texarkana, TX 75503, USA",
  "bookingUrl": "https://ee-system.com/arklatex-eenergy-healing-center-2754",
  "lat": 33.4554566,
  "lng": -94.06533436,
  "country": "United States",
  "googlemaps": "https://www.google.com/maps/place/..."
}
```

**Batch Update (Array):**
```json
[
  {
    "name": "Center 1",
    "address": "Address 1",
    "bookingUrl": "https://...",
    "lat": 40.123,
    "lng": -74.456,
    "country": "United States"
  },
  {
    "name": "Center 2",
    "address": "Address 2",
    "bookingUrl": "https://...",
    "lat": 51.123,
    "lng": -2.456,
    "country": "United Kingdom"
  }
]
```

---

## **⚙️ Advanced Configuration Options**

### **Option 1: Row-by-Row Processing (Recommended)**
- Trigger: "Watch Changes" 
- Processes one row at a time
- Better error handling
- Real-time updates

### **Option 2: Batch Processing**
- Trigger: "Watch Rows" with aggregator
- Processes multiple rows at once
- More efficient for bulk changes
- Use when adding many locations

---

## **🧪 Testing Your Setup**

### **1. Test Webhook Endpoint**
Visit: `https://eesystems-location-finder-html-maker.onrender.com/webhook/make-com/test`

Should return:
```json
{
  "success": true,
  "message": "Make.com webhook endpoint is working",
  "timestamp": "2025-09-13T09:00:00.000Z"
}
```

### **2. Test Make.com Scenario**
1. Add a new row to your Google Sheet
2. Check Make.com execution log
3. Verify location appears in webapp at `/admin`

### **3. Manual Test with Postman/curl**
```bash
curl -X POST https://eesystems-location-finder-html-maker.onrender.com/webhook/make-com \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Center",
    "address": "123 Test St, Test City, TC 12345",
    "bookingUrl": "https://ee-system.com/test-center",
    "lat": 40.7128,
    "lng": -74.0060,
    "country": "United States"
  }'
```

---

## **🛡️ Error Handling & Monitoring**

### **Common Errors & Solutions:**

**❌ "Invalid webhook data format"**
- Check your JSON format in Make.com
- Ensure all column mappings are correct

**❌ "Missing required fields: name and address"**
- Verify your Google Sheet has "name" and "address" columns
- Check that rows aren't empty

**❌ "Location not found"**
- Lat/lng coordinates might be missing or invalid
- Address format might need correction

### **Success Response:**
```json
{
  "success": true,
  "message": "Location update processed successfully",
  "location": {
    "name": "Center Name",
    "address": "Full Address",
    "country": "United States"
  },
  "action": "created",
  "timestamp": "2025-09-13T09:00:00.000Z"
}
```

---

## **📱 Admin Dashboard Integration**

After setting up Make.com, you can:

1. **Monitor Updates:** Visit `/admin` to see all locations
2. **CSV Upload:** Still available for bulk imports
3. **Manual Editing:** Use the location cards for corrections
4. **Real-time Sync:** Changes appear instantly from Google Sheets

---

## **🔄 Workflow Summary**

1. **Update Google Sheet** → Add/modify location data
2. **Make.com Detects Change** → Triggers scenario automatically  
3. **Webhook Processes Data** → Validates and cleans the data
4. **Database Updates** → Location added/updated in database
5. **Live Site Updates** → Changes appear on `/finder` immediately

---

## **📞 Support & Troubleshooting**

### **Debug Steps:**
1. Check Make.com execution history for errors
2. Test webhook endpoint directly (see testing section)
3. Verify Google Sheets column headers match exactly
4. Use `/admin` dashboard to monitor database changes

### **Webhook URL for Reference:**
```
https://eesystems-location-finder-html-maker.onrender.com/webhook/make-com
```

### **Your Make.com Webhook (Current):**
```
https://hook.us2.make.com/puxcx8syc6sq8u4c4ky8ihyfmsmhk8f1
```

**Note:** You'll need to point your Make.com scenario to our webhook URL above, not the Make.com hook URL you provided (that's for incoming webhooks to Make.com, but we need outgoing webhooks from Make.com to our system).

---

## **✅ Final Checklist**

- [ ] Make.com scenario created and configured
- [ ] Google Sheets connected with correct column headers
- [ ] Webhook URL configured correctly
- [ ] Test update performed successfully
- [ ] Admin dashboard shows new locations
- [ ] Live finder displays updated data

**🎉 Congratulations! Your EESystem location database now auto-syncs with Google Sheets via Make.com!**
