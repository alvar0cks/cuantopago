import type { ReceiptAnalysis } from '../types';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');

export async function analyzeReceipt(
  imageUri: string,
  mimeType = 'image/jpeg',
): Promise<ReceiptAnalysis> {
  if (!API_URL) {
    throw new Error('Falta configurar EXPO_PUBLIC_API_URL en mobile/.env');
  }

  const form = new FormData();
  form.append(
    'image',
    {
      uri: imageUri,
      type: mimeType,
      name: `boleta-${Date.now()}.jpg`,
    } as unknown as Blob,
  );

  const response = await fetch(`${API_URL}/api/receipts/analyze`, {
    method: 'POST',
    body: form,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'No fue posible analizar la boleta.');
  }

  return data as ReceiptAnalysis;
}
