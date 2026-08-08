import { Platform } from 'react-native';
import type { ReceiptAnalysis } from '../types';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');

async function parseResponse(
  status: number,
  raw: string,
): Promise<ReceiptAnalysis> {
  let data: Record<string, unknown>;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `El backend respondió con un formato inválido (${status}).`,
    );
  }

  if (status < 200 || status >= 300) {
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : `No fue posible analizar la boleta (${status}).`,
    );
  }

  return data as unknown as ReceiptAnalysis;
}

async function analyzeNativeReceipt(
  imageUri: string,
  mimeType: string,
): Promise<ReceiptAnalysis> {
  const form = new FormData();

  // React Native permite adjuntar archivos nativos mediante uri/name/type.
  // Esto evita el fallo de FileSystem.uploadAsync en Android con assets
  // empaquetados (por ejemplo la boleta de prueba).
  form.append(
    'image',
    {
      uri: imageUri,
      name: `boleta-${Date.now()}.jpg`,
      type: mimeType || 'image/jpeg',
    } as unknown as Blob,
  );

  const response = await fetch(`${API_URL}/api/receipts/analyze`, {
    method: 'POST',
    body: form,
  });

  return parseResponse(response.status, await response.text());
}

async function analyzeWebReceipt(
  imageUri: string,
  mimeType: string,
): Promise<ReceiptAnalysis> {
  const imageResponse = await fetch(imageUri);

  if (!imageResponse.ok) {
    throw new Error('No se pudo preparar la imagen seleccionada.');
  }

  const blob = await imageResponse.blob();
  const file = new File([blob], `boleta-${Date.now()}.jpg`, {
    type: mimeType || blob.type || 'image/jpeg',
  });

  const form = new FormData();
  form.append('image', file);

  const response = await fetch(`${API_URL}/api/receipts/analyze`, {
    method: 'POST',
    body: form,
  });

  return parseResponse(response.status, await response.text());
}

export async function analyzeReceipt(
  imageUri: string,
  mimeType = 'image/jpeg',
): Promise<ReceiptAnalysis> {
  if (!API_URL) {
    throw new Error(
      'Falta configurar EXPO_PUBLIC_API_URL para conectar con el backend.',
    );
  }

  return Platform.OS === 'web'
    ? analyzeWebReceipt(imageUri, mimeType)
    : analyzeNativeReceipt(imageUri, mimeType);
}
