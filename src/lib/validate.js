const { z } = require('zod');

const schemas = {
  search: z.object({
    q: z.string().trim().min(1),
    limit: z.coerce.number().int().positive().max(100).default(10).optional()
  }),
  nearest: z.object({
    lat: z.coerce.number().refine(n => Number.isFinite(n), 'Invalid latitude'),
    lng: z.coerce.number().refine(n => Number.isFinite(n), 'Invalid longitude'),
    limit: z.coerce.number().int().positive().max(100).default(5).optional()
  }),
  byLocation: z.object({
    country: z.string().trim().min(1),
    city: z.string().trim().min(1).optional()
  })
};

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          details: result.error.flatten()
        }
      });
    }
    req.validated = result.data;
    next();
  };
}

module.exports = { validate, schemas };
