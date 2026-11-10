import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReceiptItem, TransferData } from '../types';

const STORAGE_KEY = '@cuantopago/pending-bills/v1';
export type PendingBill = {
  id: string;
  savedAt: string;
  step: number;
  items: ReceiptItem[];
  people: string[];
  invitedPeople: string[];
  assignments: Record<string, string[]>;
  payer: string;
  tipPercent: string;
  tipMode: 'proportional' | 'equal';
  detectedTipAmount: number | null;
  useDetectedTip: boolean;
  includeTransfer: boolean;
  transfer: TransferData;
};
export async function getPendingBills(): Promise<PendingBill[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  return Array.isArray(value) ? value as PendingBill[] : [];
}
export async function savePendingBill(bill: PendingBill): Promise<PendingBill[]> {
  // Una sola cuenta pendiente: reemplazar únicamente al guardar explícitamente.
  const updated = [bill];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}
export async function deletePendingBill(id: string): Promise<PendingBill[]> {
  const updated = (await getPendingBills()).filter(entry => entry.id !== id);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}
