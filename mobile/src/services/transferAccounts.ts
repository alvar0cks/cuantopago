import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TransferData } from '../types';

const STORAGE_KEY = '@cuantopago/transfer-accounts/v1';

export type SavedTransferAccount = {
  id: string;
  label: string;
  transfer: TransferData;
  isDefault: boolean;
  createdAt: string;
};

type NewTransferAccount = {
  label: string;
  transfer: TransferData;
  isDefault?: boolean;
};

function createId(): string {
  return `account-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadTransferAccounts(): Promise<SavedTransferAccount[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedTransferAccount[]) : [];
  } catch {
    return [];
  }
}

export async function saveTransferAccount(
  input: NewTransferAccount,
): Promise<SavedTransferAccount[]> {
  const current = await loadTransferAccounts();

  const nextAccount: SavedTransferAccount = {
    id: createId(),
    label: input.label.trim(),
    transfer: {
      bank: input.transfer.bank.trim(),
      accountType: input.transfer.accountType.trim(),
      accountNumber: input.transfer.accountNumber.trim(),
      rut: input.transfer.rut.trim(),
    },
    isDefault: Boolean(input.isDefault),
    createdAt: new Date().toISOString(),
  };

  const normalized = nextAccount.isDefault
    ? current.map((account) => ({ ...account, isDefault: false }))
    : current;

  const updated = [...normalized, nextAccount];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export async function deleteTransferAccount(
  id: string,
): Promise<SavedTransferAccount[]> {
  const current = await loadTransferAccounts();
  const deleted = current.find((account) => account.id === id);
  let updated = current.filter((account) => account.id !== id);

  if (deleted?.isDefault && updated.length) {
    updated = updated.map((account, index) => ({
      ...account,
      isDefault: index === 0,
    }));
  }

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}
