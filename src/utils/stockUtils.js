function normalizeInvoiceItems(items = []) {
  return items
    .filter((item) => item && item.name && item.batchNumber)
    .map((item) => ({
      name: String(item.name).trim(),
      distributor: String(item.distributor || "Unknown").trim(),
      batchNumber: String(item.batchNumber).trim(),
      expiryDate: new Date(item.expiryDate),
      quantity: Number(item.quantity || 0),
      purchaseRate: Number(item.purchaseRate || 0),
      mrp: Number(item.mrp || 0),
    }));
}

function getExpiryCounts(medicines = [], withinDays = 30) {
  const now = Date.now();
  const windowMs = withinDays * 24 * 60 * 60 * 1000;
  let expiryCount = 0;

  for (const med of medicines) {
    for (const batch of med.batches || []) {
      const exp = new Date(batch.expiryDate).getTime();
      if (Number.isFinite(exp) && exp - now <= windowMs) {
        expiryCount += 1;
      }
    }
  }
  return expiryCount;
}

module.exports = { normalizeInvoiceItems, getExpiryCounts };
