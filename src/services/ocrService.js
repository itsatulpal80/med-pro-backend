const { cloudinary, configureCloudinary } = require("../config/cloudinary");
const { parseInvoiceWithAi } = require("./aiService");
const { ApiError } = require("../utils/apiError");

const cloudinaryReady = configureCloudinary();

function toBase64FromUpload(file) {
  if (!file?.buffer) return null;
  return file.buffer.toString("base64");
}

function toBase64FromBody(base64Image) {
  if (!base64Image || typeof base64Image !== "string") return null;
  if (base64Image.startsWith("data:")) {
    const [, payload = ""] = base64Image.split(",");
    return payload;
  }
  return base64Image;
}

function detectMimeType(file, base64Image) {
  if (file?.mimetype) return file.mimetype;
  if (typeof base64Image === "string" && base64Image.startsWith("data:")) {
    const meta = base64Image.slice(5, base64Image.indexOf(";"));
    return meta || "image/jpeg";
  }
  return "image/jpeg";
}

async function uploadToCloudinaryIfEnabled(file) {
  if (!cloudinaryReady || !file?.buffer) return null;
  const dataUri = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "pharmacy-invoices",
    resource_type: "image",
  });
  return result.secure_url;
}

async function scanInvoiceImage({ file, base64Image }) {
  const normalizedBase64 = toBase64FromUpload(file) || toBase64FromBody(base64Image);
  if (!normalizedBase64) {
    throw new ApiError(400, "Image is required (multipart file or base64Image)");
  }

  const mimeType = detectMimeType(file, base64Image);
  const cloudinaryUrl = await uploadToCloudinaryIfEnabled(file);
  const parsed = await parseInvoiceWithAi({ base64Image: normalizedBase64, mimeType });

  return { parsed, cloudinaryUrl };
}

module.exports = { scanInvoiceImage };
