import { Platform } from 'react-native';
import type { ReceiptAnalysis } from '../types';
import { File } from 'expo-file-system';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');

function friendlyHttpError(status: number): Error {
  if (status === 429 || status === 503) return new Error('SERVICE_BUSY');
  if (status >= 500) return new Error('SERVICE_ERROR');
  return new Error('ANALYSIS_ERROR');
}

async function parseResponse(status: number, raw: string): Promise<ReceiptAnalysis> {
  let data: Record<string, unknown>;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    if (status < 200 || status >= 300) throw friendlyHttpError(status);
    throw new Error('INVALID_RESPONSE');
  }

  if (status < 200 || status >= 300) {
    throw friendlyHttpError(status);
  }

  return data as unknown as ReceiptAnalysis;
}

async function postReceipt(form: FormData): Promise<ReceiptAnalysis> {
  try {
    const response = await fetch(`${API_URL}/api/receipts/analyze`, {
      method: 'POST',
      body: form,
    });

    const raw = await response.text();

    if (!response.ok) {
      console.error('[CuantoPago API]', `HTTP ${response.status}`, raw || '(respuesta vacía)');
    }

    return parseResponse(response.status, raw);
  } catch (error) {
    console.error('[CuantoPago API] ERROR REAL:', error);

    if (error instanceof Error) {
      console.error('[CuantoPago API] nombre:', error.name);
      console.error('[CuantoPago API] mensaje:', error.message);
      console.error('[CuantoPago API] stack:', error.stack);
    }

    if (
      error instanceof Error &&
      ['SERVICE_BUSY', 'SERVICE_ERROR', 'ANALYSIS_ERROR', 'INVALID_RESPONSE'].includes(error.message)
    ) {
      throw error;
    }

    throw new Error('NETWORK_ERROR');
  }
}

async function analyzeWebReceipt(imageUri: string, mimeType: string): Promise<ReceiptAnalysis> {
  try {
    const imageResponse = await fetch(imageUri);
    const blob = await imageResponse.blob();
    const form = new FormData();
    form.append('image', blob, `receipt.${mimeType.includes('png') ? 'png' : 'jpg'}`);
    return postReceipt(form);
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('_ERROR')) throw error;
    console.error('[CuantoPago API] ERROR REAL WEB:', error);
    throw new Error('NETWORK_ERROR');
  }
}

async function analyzeNativeReceipt(imageUri: string): Promise<ReceiptAnalysis> {
  try {
    const form = new FormData();
    const imageFile = new File(imageUri);
    form.append('image', imageFile as unknown as Blob);
    return postReceipt(form);
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('_ERROR')) throw error;
    console.error('[CuantoPago API] ERROR REAL NATIVE:', error);
    throw new Error('NETWORK_ERROR');
  }
}

export async function analyzeReceipt(
  imageUri: string,
  mimeType = 'image/jpeg',
): Promise<ReceiptAnalysis> {
  if (!API_URL) throw new Error('CONFIG_ERROR');

  return Platform.OS === 'web'
    ? analyzeWebReceipt(imageUri, mimeType)
    : analyzeNativeReceipt(imageUri);
}
