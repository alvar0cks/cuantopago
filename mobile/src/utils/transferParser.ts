import type { TransferData } from '../types';

const BANK_ALIASES: Array<{
  canonical: string;
  patterns: RegExp[];
}> = [
  {
    canonical: 'BancoEstado',
    patterns: [/\bbanco\s*estado\b/i, /\bbancoestado\b/i],
  },
  {
    canonical: 'Banco de Chile',
    patterns: [/\bbanco\s+de\s+chile\b/i],
  },
  {
    canonical: 'Banco Bci',
    patterns: [/\bbanco\s+bci\b/i, /\bbci\b/i],
  },
  {
    canonical: 'Santander',
    patterns: [/\bbanco\s+santander\b/i, /\bsantander\b/i],
  },
  {
    canonical: 'Itaú',
    patterns: [/\bbanco\s+ita[uú]\b/i, /\bita[uú]\b/i],
  },
  {
    canonical: 'Scotiabank',
    patterns: [/\bscotiabank\b/i],
  },
  {
    canonical: 'Banco Falabella',
    patterns: [/\bbanco\s+falabella\b/i],
  },
  {
    canonical: 'Banco Ripley',
    patterns: [/\bbanco\s+ripley\b/i],
  },
  {
    canonical: 'Banco Security',
    patterns: [/\bbanco\s+security\b/i],
  },
  {
    canonical: 'Banco Internacional',
    patterns: [/\bbanco\s+internacional\b/i],
  },
  {
    canonical: 'Banco BICE',
    patterns: [/\bbanco\s+bice\b/i, /\bbice\b/i],
  },
  {
    canonical: 'Tenpo',
    patterns: [/\btenpo\b/i],
  },
  {
    canonical: 'Mercado Pago',
    patterns: [/\bmercado\s+pago\b/i],
  },
  {
    canonical: 'MACH',
    patterns: [/\bmach\b/i],
  },
];

const ACCOUNT_TYPES = [
  'Cuenta Corriente',
  'Cuenta RUT',
  'Cuenta Vista',
  'Cuenta Chequera Electrónica',
  'Chequera Electrónica',
  'Cuenta de Ahorro',
  'Cuenta Digital',
];

function cleanLine(line: string): string {
  return line
    .replace(/^[•\-–—\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparison(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function detectBank(lines: string[]): string {
  const completeText = lines.join(' ');

  for (const bank of BANK_ALIASES) {
    if (bank.patterns.some((pattern) => pattern.test(completeText))) {
      return bank.canonical;
    }
  }

  const labeledLine = lines.find((line) =>
    /^(banco|instituci[oó]n|entidad)\s*:/i.test(line),
  );

  return labeledLine
    ? labeledLine.replace(/^[^:]+:\s*/i, '').trim()
    : '';
}

function detectAccountType(lines: string[]): {
  value: string;
  index: number;
} {
  for (let index = 0; index < lines.length; index += 1) {
    const normalizedLine = normalizeComparison(lines[index]);

    const type = ACCOUNT_TYPES.find(
      (accountType) =>
        normalizedLine === normalizeComparison(accountType) ||
        normalizedLine.includes(normalizeComparison(accountType)),
    );

    if (type) {
      return { value: type, index };
    }
  }

  return { value: '', index: -1 };
}

function detectRut(lines: string[]): string {
  const completeText = lines.join(' ');

  const match = completeText.match(
    /\b(?:\d{1,2}\.\d{3}\.\d{3}-[\dKk]|\d{7,8}-[\dKk])\b/,
  );

  return match ? match[0].toUpperCase() : '';
}

function isEmail(line: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(line);
}

function isRutLine(line: string): boolean {
  return /^(?:\d{1,2}\.\d{3}\.\d{3}-[\dKk]|\d{7,8}-[\dKk])$/i.test(
    line,
  );
}

function isAccountTypeLine(line: string): boolean {
  const normalized = normalizeComparison(line);

  return ACCOUNT_TYPES.some(
    (type) => normalized === normalizeComparison(type),
  );
}

function isBankLine(line: string): boolean {
  return BANK_ALIASES.some((bank) =>
    bank.patterns.some((pattern) => pattern.test(line)),
  );
}

function isPossibleAccountNumber(line: string): boolean {
  if (isEmail(line)) return false;
  if (isRutLine(line)) return false;
  if (isAccountTypeLine(line)) return false;
  if (isBankLine(line)) return false;

  // Permite cuentas con números, guiones, puntos y espacios.
  if (!/^[\d.\-\s]+$/.test(line)) return false;

  const digits = line.replace(/\D/g, '');

  // Rango amplio para distintos bancos.
  return digits.length >= 6 && digits.length <= 20;
}

function detectLabeledAccountNumber(lines: string[]): string {
  const labels = [
    /^n(?:ú|u)mero\s+de\s+cuenta\s*[:\-]?\s*/i,
    /^n[°º]\s*(?:de\s+)?cuenta\s*[:\-]?\s*/i,
    /^cuenta\s+n[°º]?\s*[:\-]?\s*/i,
    /^account\s+number\s*[:\-]?\s*/i,
  ];

  for (const line of lines) {
    for (const label of labels) {
      if (!label.test(line)) continue;

      const value = line.replace(label, '').trim();

      if (isPossibleAccountNumber(value)) {
        return value;
      }
    }
  }

  return '';
}

function detectAccountNumber(
  lines: string[],
  accountTypeIndex: number,
): string {
  const labeled = detectLabeledAccountNumber(lines);
  if (labeled) return labeled;

  // Caso más común:
  // nombre → RUT → banco → tipo de cuenta → número → correo.
  if (accountTypeIndex >= 0) {
    for (
      let index = accountTypeIndex + 1;
      index < lines.length;
      index += 1
    ) {
      if (isPossibleAccountNumber(lines[index])) {
        return lines[index];
      }
    }
  }

  // Respaldo para formatos con otro orden.
  return lines.find(isPossibleAccountNumber) || '';
}

export function parseTransferText(
  text: string,
): Partial<TransferData> {
  const lines = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  const bank = detectBank(lines);
  const accountType = detectAccountType(lines);
  const rut = detectRut(lines);
  const accountNumber = detectAccountNumber(
    lines,
    accountType.index,
  );

  return {
    bank,
    accountType: accountType.value,
    accountNumber: accountNumber.replace(/\s+/g, '').trim(),
    rut,
  };
}