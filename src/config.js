const dotenv = require('dotenv');
const { z } = require('zod');

// Load environment variables from .env file
dotenv.config();

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default('development'),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  DATA_STORE: z.string().default('json'),
  MODE: z.string().default('basic'),
  GEOCODER: z.string().default('nominatim'),
  ENABLE_ADMIN: z.coerce.boolean().default(false),
  ADMIN_TOKEN: z.string().optional(),
  USE_LOCAL_DB: z.coerce.boolean().default(false),
  REDIS_URL: z.string().optional(),
  NOMINATIM_UA: z.string().optional(),
  NOMINATIM_EMAIL: z.string().optional(),
  DATABASE_URL: z.string().optional()
});

const config = configSchema.parse(process.env);

module.exports = config;
