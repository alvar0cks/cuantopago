export type ReceiptItem = {
  id: string;
  name: string;
  price: number;
  quantity?: number;
};

export type ReceiptAnalysis = {
  merchant?: string;
  items: ReceiptItem[];
  subtotal?: number | null;
  tax?: number | null;
  tip?: number | null;
  discounts?: number | null;
  total?: number | null;
  currency?: string;
  notes?: string[];
};

export type TransferData = {
  bank: string;
  accountType: string;
  accountNumber: string;
  rut: string;
};
