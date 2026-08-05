import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { ReceiptAnalysis } from '../types';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');

async function analyzeNativeReceipt(imageUri: string, mimeType: string): Promise<ReceiptAnalysis> {
  const result = await FileSystem.uploadAsync(`${API_URL}/api/receipts/analyze`, imageUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'image',
    mimeType: mimeType || 'image/jpeg',
  });

  let data: Record<string, unknown>;
  try { data = result.body ? JSON.parse(result.body) : {}; }
  catch { throw new Error(`El backend respondió con un formato inválido (${result.status}).`); }

  if (result.status < 200 || result.status >= 300) {
    throw new Error(typeof data.error === 'string' ? data.error : `No fue posible analizar la boleta (${result.status}).`);
  }
  return data as unknown as ReceiptAnalysis;
}

async function analyzeWebReceipt(imageUri: string, mimeType: string): Promise<ReceiptAnalysis> {
  const imageResponse = await fetch(imageUri);
  if (!imageResponse.ok) throw new Error('No se pudo preparar la imagen seleccionada.');

  const blob = await imageResponse.blob();
  const file = new File([blob], `boleta-${Date.now()}.jpg`, { type: mimeType || blob.type || 'image/jpeg' });
  const form = new FormData();
  form.append('image', file);

  const response = await fetch(`${API_URL}/api/receipts/analyze`, { method: 'POST', body: form });
  const text = await response.text();
  let data: Record<string, unknown>;
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`El backend respondió con un formato inválido (${response.status}).`); }

  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `No fue posible analizar la boleta (${response.status}).`);
  }
  return data as unknown as ReceiptAnalysis;
}

export async function analyzeReceipt(imageUri: string, mimeType = 'image/jpeg'): Promise<ReceiptAnalysis> {
  if (!API_URL) throw new Error('Falta configurar EXPO_PUBLIC_API_URL para conectar con el backend.');
  return Platform.OS === 'web'
    ? analyzeWebReceipt(imageUri, mimeType)
    : analyzeNativeReceipt(imageUri, mimeType);
}
