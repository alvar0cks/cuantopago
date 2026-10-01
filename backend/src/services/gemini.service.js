import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

const ReceiptSchema = z.object({
  merchant: z.string().nullable().optional().default('').transform((value) => value ?? ''),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        price: z.number().nonnegative(),
        quantity: z.number().positive().optional().default(1),
      }),
    )
    .default([]),
  subtotal: z.number().nonnegative().optional().nullable(),
  tax: z.number().nonnegative().optional().nullable(),
  tip: z.number().nonnegative().optional().nullable(),
  discounts: z.number().nonnegative().optional().nullable(),
  total: z.number().nonnegative().optional().nullable(),
  currency: z.string().nullable().optional().default('CLP').transform((value) => value || 'CLP'),
  notes: z.array(z.string()).nullable().optional().default([]).transform((value) => value ?? []),
});

const prompt = `
Analiza la imagen de esta boleta de restaurante o comercio.
Devuelve exclusivamente un objeto JSON válido, sin markdown ni explicaciones.

Formato esperado:
{
  "merchant": "Nombre del local",
  "items": [
    { "name": "Producto", "price": 1234, "quantity": 1 }
  ],
  "subtotal": 1234,
  "tax": 0,
  "tip": 0,
  "discounts": 0,
  "total": 1234,
  "currency": "CLP",
  "notes": []
}

Reglas:
- Usa números sin símbolos de moneda ni separadores de miles.
- Si una línea tiene una cantidad distinta de 1 (por ejemplo 0.5, 2 o 3), conserva en "price" el precio total cobrado en esa línea y registra la cantidad exactamente como aparece.
- No dupliques subtotal, IVA, propina, descuentos o total como productos.
- Si merchant no aparece o no puede identificarse, utiliza "".
- Para subtotal, tax, tip, discounts o total que no aparezcan, utiliza null.
- Nunca inventes información que no sea visible en la boleta.
- Si no puedes leer un texto, agrega una breve observación en "notes".
`;

function extractJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('Gemini no devolvió un JSON reconocible.');
  }
  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
}

async function generateWithRetry(ai, params, maxRetries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await ai.models.generateContent(params);
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || error?.code || 0);
      const message = String(error?.message || '');
      const lowerMessage = message.toLowerCase();

      // Cuota agotada: reintentar inmediatamente no sirve y solo genera más solicitudes.
      const quotaExhausted =
        status === 429 &&
        (lowerMessage.includes('exceeded your current quota') ||
          lowerMessage.includes('quota exceeded') ||
          lowerMessage.includes('generaterequestsperday') ||
          lowerMessage.includes('resource_exhausted'));

      // Saturación temporal del modelo: sí vale la pena reintentar.
      const temporaryUnavailable =
        status === 503 ||
        message.includes('503') ||
        message.includes('UNAVAILABLE') ||
        lowerMessage.includes('high demand');

      // Un 429 que sea rate limit temporal (y no cuota diaria agotada) puede reintentarse.
      const temporaryRateLimit = status === 429 && !quotaExhausted;
      const retryable = temporaryUnavailable || temporaryRateLimit;

      console.error(
        `[Gemini] intento ${attempt + 1}/${maxRetries + 1} falló`,
        { status, quotaExhausted, message },
      );

      if (quotaExhausted) {
        const quotaError = new Error('GEMINI_QUOTA_EXHAUSTED');
        quotaError.status = 429;
        quotaError.cause = error;
        throw quotaError;
      }

      if (!retryable || attempt === maxRetries) throw error;

      const delayMs = 1000 * (2 ** attempt);
      console.warn(`[Gemini] reintentando en ${delayMs} ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

export async function analyzeReceipt({ buffer, mimeType }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error('El backend no tiene configurada GEMINI_API_KEY.');
    error.status = 500;
    throw error;
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const response = await generateWithRetry(ai, {
    model,
    contents: [
      { text: prompt },
      {
        inlineData: {
          mimeType,
          data: buffer.toString('base64'),
        },
      },
    ],
    config: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });

  const parsed = extractJson(response.text || '');

  // Gemini puede devolver null aunque el prompt solicite "".
  // Normalizamos antes de Zod para que una boleta sin nombre de comercio no falle.
  const normalized = {
    ...parsed,
    merchant: typeof parsed?.merchant === 'string' ? parsed.merchant : '',
    currency: typeof parsed?.currency === 'string' && parsed.currency.trim()
      ? parsed.currency
      : 'CLP',
    notes: Array.isArray(parsed?.notes) ? parsed.notes : [],
  };

  let validated;
  try {
    validated = ReceiptSchema.parse(normalized);
  } catch (error) {
    console.error('[Gemini] JSON recibido:', JSON.stringify(parsed));
    console.error('[Gemini] Error de validación:', error);
    throw error;
  }

  return {
    ...validated,
    merchant: validated.merchant || '',
    items: validated.items.map((item, index) => ({
      id: `item-${Date.now()}-${index}`,
      ...item,
    })),
  };
}
