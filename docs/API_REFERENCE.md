# API Reference

## Endpoints

### `GET /api/locations/search`
Search locations by keyword.

**Query Parameters**
- `q` (required): search term.
- `limit` (optional, default `10`): max results.

**Response**
```json
{
  "ok": true,
  "data": [
    {
      "id": 1,
      "name": "Center Name",
      "address": "123 Main St, City, State",
      "bookingUrl": "https://example.com/book",
      "googleMapsLink": "https://maps.google.com/...",
      "latitude": 12.34,
      "longitude": -56.78,
      "country": "US"
    }
  ],
  "meta": {
    "total": 1,
    "query": "tex"
  }
}
```

### `GET /api/locations/nearest`
Return locations nearest to coordinates.

**Query Parameters**
- `lat` (required): latitude.
- `lng` (required): longitude.
- `limit` (optional, default `10`): max results.

**Response**
```json
{
  "ok": true,
  "data": [
    {
      "id": 2,
      "name": "Nearby Center",
      "address": "456 Elm St, Town, Region",
      "bookingUrl": "https://example.com/book",
      "googleMapsLink": "https://maps.google.com/...",
      "latitude": 12.30,
      "longitude": -56.80,
      "country": "US",
      "distance": 1.2
    }
  ],
  "meta": {
    "total": 1,
    "userLocation": {"lat": 12.34, "lng": -56.78}
  }
}
```

### `GET /api/locations/by-location`
Filter locations by country and optional city.

**Query Parameters**
- `country` (required): ISO country name or code.
- `city` (optional): city substring.

**Response**
```json
{
  "ok": true,
  "data": [
    {
      "id": 3,
      "name": "City Center",
      "address": "789 Oak St, Las Vegas, NV 89101",
      "bookingUrl": "https://example.com/book",
      "googleMapsLink": "https://maps.google.com/...",
      "latitude": 36.17,
      "longitude": -115.14,
      "country": "US"
    }
  ],
  "meta": {
    "total": 1,
    "filters": {"country": "United States", "city": "Las Vegas"}
  }
}
```

### `POST /api/locations/geocode`
Geocode an address and return coordinates.

**Request Body**
```json
{
  "address": "1600 Pennsylvania Ave NW, Washington, DC"
}
```

**Response**
```json
{
  "success": true,
  "query": "1600 Pennsylvania Ave NW, Washington, DC",
  "coordinates": {"lat": 38.8977, "lng": -77.0365}
}
```

## Rate Limiting
- Requests are limited to **100** per **15‑minute window** by default.
- Applies to `/search`, `/api/locations/geocode`, and `/upload` endpoints.
- Configure limit via the `RATE_LIMIT_MAX` environment variable.
- Exceeding the limit returns HTTP `429 Too Many Requests`.

## Admin Mode Guide
Admin features are disabled by default. Enable with:

```
ENABLE_ADMIN=true
ADMIN_TOKEN=your-secret-token
```

### Tokens
Include the admin token via query string `?token=your-secret-token` or header `X-Admin-Token: your-secret-token`.

### Endpoints
- `/admin` – dashboard for managing locations
- `/ai-interface` – experimental AI utilities

### Security Considerations
- Use strong, unique tokens and keep them secret.
- Serve over HTTPS to protect tokens in transit.
- Disable admin mode in production environments.
