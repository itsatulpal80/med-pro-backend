const mongoose = require("mongoose");

const batchSchema = new mongoose.Schema(
  {
    batchNumber: { type: String, required: true, trim: true },
    expiryDate: { type: Date, required: true },
    quantity: { type: Number, required: true, min: 0 },
    purchaseRate: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const medicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    distributor: { type: String, default: "Unknown", trim: true },
    totalQuantity: { type: Number, default: 0, min: 0, index: true },
    batches: [batchSchema],
  },
  { timestamps: true },
);

medicineSchema.index({ name: 1, distributor: 1 });

module.exports = mongoose.model("Medicine", medicineSchema);
