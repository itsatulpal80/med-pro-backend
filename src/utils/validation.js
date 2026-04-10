const { z } = require("zod");
const { ApiError } = require("./apiError");

const registerSchema = z.object({
  name: z.string().min(2),
  mobile: z.string().min(8),
  password: z.string().min(6),
  role: z.string().optional(),
});

const loginSchema = z.object({
  mobile: z.string().min(8),
  password: z.string().min(6),
});

const ocrItemSchema = z.object({
  name: z.string().min(1),
  distributor: z.string().optional(),
  batchNumber: z.string().min(1),
  expiryDate: z.string().min(4),
  quantity: z.number().nonnegative(),
  purchaseRate: z.number().nonnegative(),
  mrp: z.number().nonnegative(),
});

const addFromOcrSchema = z.object({
  supplierName: z.string().optional(),
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string().optional(),
  items: z.array(ocrItemSchema).min(1),
});

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new ApiError(400, result.error.issues[0]?.message || "Invalid body"));
    }
    req.body = result.data;
    next();
  };
}

module.exports = {
  validateBody,
  registerSchema,
  loginSchema,
  addFromOcrSchema,
};
