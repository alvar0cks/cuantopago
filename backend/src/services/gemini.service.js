import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

const ReceiptSchema = z.object({
  merchant: z.string().optional().default(''),
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
  currency: z.string().optional().default('CLP'),
  notes: z.array(z.string()).optional().default([]),
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
- Si una línea tiene cantidad mayor a 1, conserva el precio total de esa línea en "price" y registra la cantidad.
- No dupliques subtotal, IVA, propina, descuentos o total como productos.
- Si un valor no aparece, utiliza null.
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

export async function analyzeReceipt({ buffer, mimeType }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error('El backend no tiene configurada GEMINI_API_KEY.');
    error.status = 500;
    throw error;
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

  const response = await ai.models.generateContent({
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
  const validated = ReceiptSchema.parse(parsed);

  return {
    ...validated,
    items: validated.items.map((item, index) => ({
      id: `item-${Date.now()}-${index}`,
      ...item,
    })),
  };
}
