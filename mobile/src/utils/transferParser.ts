import type { TransferData } from '../types';

const BANK_NAMES = ['BancoEstado','Banco de Chile','Santander','BCI','Banco BCI','Itaú','Itau','Scotiabank','Banco Falabella','Banco Ripley','Banco Security','Banco Internacional','BICE','Tenpo','Mercado Pago','MACH','Copec Pay'];
const ACCOUNT_TYPES = ['Cuenta RUT','Cuenta Corriente','Cuenta Vista','Cuenta Chequera Electrónica','Chequera Electrónica','Cuenta de Ahorro','Cuenta Digital'];

function cleanLine(line: string): string {
  return line.replace(/^[•\-–—\s]+/, '').replace(/\s+/g, ' ').trim();
}

function valueAfterLabel(lines: string[], labels: RegExp[]): string {
  for (const line of lines) {
    for (const label of labels) {
      if (label.test(line)) {
        const value = line.replace(label, '').replace(/^[:\s-]+/, '').trim();
        if (value) return value;
      }
    }
  }
  return '';
}

function normalizeRut(value: string): string {
  return value.toUpperCase().replace(/[^0-9K.\-]/g, '').trim();
}

export function parseTransferText(text: string): Partial<TransferData> {
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const joined = lines.join(' ');
  const bank = BANK_NAMES.find((name) => joined.toLocaleLowerCase('es-CL').includes(name.toLocaleLowerCase('es-CL'))) || valueAfterLabel(lines, [/^banco\b/i, /^instituci[oó]n\b/i, /^entidad\b/i]);
  const accountType = ACCOUNT_TYPES.find((type) => joined.toLocaleLowerCase('es-CL').includes(type.toLocaleLowerCase('es-CL'))) || valueAfterLabel(lines, [/^tipo de cuenta\b/i, /^tipo cuenta\b/i, /^cuenta tipo\b/i]);
  const rutMatch = joined.match(/\b(?:\d{1,2}\.\d{3}\.\d{3}-[\dKk]|\d{7,8}-[\dKk])\b/);
  const rut = normalizeRut(rutMatch?.[0] || '') || normalizeRut(valueAfterLabel(lines, [/^rut\b/i, /^r\.u\.t\.\b/i, /^identificaci[oó]n\b/i]));
  let accountNumber = valueAfterLabel(lines, [/^n(?:ú|u)mero de cuenta\b/i, /^n[°º]\s*de cuenta\b/i, /^n[°º]\s*cuenta\b/i, /^cuenta\b/i, /^account number\b/i]);
  if (!accountNumber) {
    const candidates = lines.map((line) => line.replace(/\D/g, '')).filter((value) => value.length >= 6 && value.length <= 20);
    accountNumber = candidates.find((candidate) => !rut.replace(/\D/g, '').includes(candidate)) || '';
  }
  return { bank: bank.trim(), accountType: accountType.trim(), accountNumber: accountNumber.replace(/\s/g, ''), rut };
}
