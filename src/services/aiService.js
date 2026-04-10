const axios = require("axios");
const { env } = require("../config/env");
const { ApiError } = require("../utils/apiError");
const { extractJsonFromText } = require("../utils/extractJson");

const OCR_SYSTEM_PROMPT = `
You are an OCR parser for pharmacy purchase invoices.
Extract invoice data from the provided image and return ONLY valid JSON.
Schema:
{
  "supplierName": "string",
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "items": [
    {
      "name": "string",
      "distributor": "string",
      "batchNumber": "string",
      "expiryDate": "YYYY-MM-DD",
      "quantity": number,
      "purchaseRate": number,
      "mrp": number
    }
  ]
}
Rules:
- No markdown or prose, JSON only.
- Use null-safe defaults where needed.
- Quantity, purchaseRate, and mrp must be numbers.
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callOpenAI(base64Image, mimeType) {
  if (!env.openAiApiKey) {
    throw new ApiError(500, "OPENAI_API_KEY is missing");
  }

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: env.aiModel || "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: OCR_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract invoice JSON from this image." },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    },
    {
      headers: {
        Authorization: `Bearer ${env.openAiApiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 45000,
    },
  );

  const raw = response?.data?.choices?.[0]?.message?.content || "";
  return extractJsonFromText(raw);
}

async function callGemini(base64Image, mimeType) {
  if (!env.geminiApiKey) {
    throw new ApiError(500, "GEMINI_API_KEY is missing");
  }

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: OCR_SYSTEM_PROMPT },
          { text: "Extract invoice JSON from this image." },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
    },
  };

  const preferredModel = env.aiModel || "gemini-1.5-flash";
  const modelCandidates = [...new Set([preferredModel, "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest"])];
  const apiVersions = ["v1beta", "v1"];
  let response = null;
  let lastError = null;
  const max429Retries = 3;

  for (const version of apiVersions) {
    for (const model of modelCandidates) {
      const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${env.geminiApiKey}`;
      for (let attempt = 0; attempt <= max429Retries; attempt += 1) {
        try {
          response = await axios.post(url, requestBody, { timeout: 45000 });
          lastError = null;
          break;
        } catch (error) {
          const status = error?.response?.status;
          lastError = error;

          // Retry rate-limit errors with exponential backoff.
          if (status === 429 && attempt < max429Retries) {
            const waitMs = 1000 * (2 ** attempt);
            await sleep(waitMs);
            continue;
          }

          // Try next model/version when endpoint or model is unavailable.
          if (status === 404) {
            break;
          }

          // For a 429 after retries, try fallback model/version.
          if (status === 429) {
            break;
          }

          throw error;
        }
      }
      if (response) break;
    }
    if (response) break;
  }

  if (!response) {
    const lastStatus = lastError?.response?.status;
    if (lastStatus === 429) {
      throw new ApiError(
        429,
        "Gemini rate limit/quota exceeded. Wait a minute and retry, or switch API key/project with available quota.",
      );
    }
    throw new ApiError(
      502,
      `Gemini request failed after trying fallback models. Last error: ${
        lastError?.response?.data?.error?.message || lastError?.message || "Unknown error"
      }`,
    );
  }

  const raw =
    response?.data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") ||
    "";
  return extractJsonFromText(raw);
}

async function parseInvoiceWithAi({ base64Image, mimeType = "image/jpeg" }) {
  const provider = (env.aiProvider || "openai").toLowerCase();
  let parsed = null;
  const getProviderErrorMessage = (error, fallbackMessage) =>
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    fallbackMessage;

  if (provider === "gemini") {
    try {
      parsed = await callGemini(base64Image, mimeType);
    } catch (error) {
      const status = error?.statusCode || error?.response?.status;
      const geminiMessage = getProviderErrorMessage(error, "Gemini request failed");
      const shouldFallbackToOpenAi =
        Boolean(env.openAiApiKey) &&
        [400, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504].includes(
          Number(status),
        );

      if (shouldFallbackToOpenAi) {
        try {
          parsed = await callOpenAI(base64Image, mimeType);
        } catch (fallbackError) {
          const openAiMessage = getProviderErrorMessage(
            fallbackError,
            "OpenAI fallback request failed",
          );
          throw new ApiError(
            502,
            `Gemini failed: ${geminiMessage}. OpenAI fallback failed: ${openAiMessage}`,
          );
        }
      } else {
        throw new ApiError(
          Number(status) || 502,
          `Gemini failed: ${geminiMessage}`,
        );
      }
    }
  } else {
    try {
      parsed = await callOpenAI(base64Image, mimeType);
    } catch (error) {
      const status = error?.statusCode || error?.response?.status;
      const openAiMessage = getProviderErrorMessage(error, "OpenAI request failed");
      const shouldFallbackToGemini =
        Boolean(env.geminiApiKey) &&
        [400, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504].includes(
          Number(status),
        );

      if (shouldFallbackToGemini) {
        try {
          parsed = await callGemini(base64Image, mimeType);
        } catch (fallbackError) {
          const geminiMessage = getProviderErrorMessage(
            fallbackError,
            "Gemini fallback request failed",
          );
          throw new ApiError(
            502,
            `OpenAI failed: ${openAiMessage}. Gemini fallback failed: ${geminiMessage}`,
          );
        }
      } else {
        throw new ApiError(
          Number(status) || 502,
          `OpenAI failed: ${openAiMessage}`,
        );
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ApiError(422, "AI response parsing failed");
  }

  return parsed;
}

module.exports = { parseInvoiceWithAi, OCR_SYSTEM_PROMPT };
