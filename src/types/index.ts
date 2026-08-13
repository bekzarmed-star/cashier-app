export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'insurance' | 'mixed';

export type BillStatus = 'pending' | 'partial' | 'paid' | 'cancelled' | 'refunded';

export type ServiceCategory =
  | 'consultation'
  | 'laboratory'
  | 'radiology'
  | 'pharmacy'
  | 'procedure'
  | 'admission'
  | 'other';

export interface CashierUser {
  id: string;
  name: string;
  username: string;
  role: 'cashier' | 'supervisor' | 'admin';
  counterId: string;
  /** Optional contact phone */
  phone?: string;
  /** ERP branch code: samarkand | bukhara | karshi | shahrisabz */
  branchCode: string;
  /** Display name, e.g. Самарканд */
  branchLabel: string;
}

export interface Patient {
  id: string;
  mrn: string;
  name: string;
  phone?: string;
  age?: number;
  gender?: 'M' | 'F' | 'O';
  department?: string;
}

export interface BillItem {
  id: string;
  code: string;
  name: string;
  category: ServiceCategory;
  qty: number;
  unitPrice: number;
  discount: number;
}

export interface Bill {
  id: string;
  invoiceNo: string;
  patient: Patient;
  items: BillItem[];
  status: BillStatus;
  createdAt: string;
  notes?: string;
  paidAmount: number;
}

export interface PaymentSplit {
  method: Exclude<PaymentMethod, 'mixed'>;
  amount: number;
  reference?: string;
}

export interface Transaction {
  id: string;
  receiptNo: string;
  billId: string;
  invoiceNo: string;
  patient: Patient;
  items: BillItem[];
  payments: PaymentSplit[];
  /** ZP Account Sheet code (коды), e.g. P5, C8 */
  accountCode?: string;
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  change: number;
  cashierId: string;
  cashierName: string;
  counterId: string;
  createdAt: string;
  status: 'completed' | 'voided' | 'refunded';
}

export interface CashDrawerSession {
  id: string;
  counterId: string;
  cashierId: string;
  cashierName: string;
  openedAt: string;
  closedAt?: string;
  openingFloat: number;
  expectedCash?: number;
  countedCash?: number;
  variance?: number;
  status: 'open' | 'closed';
}

export interface DashboardStats {
  todayCollections: number;
  todayTransactions: number;
  cashTotal: number;
  cardTotal: number;
  transferTotal: number;
  insuranceTotal: number;
  pendingBills: number;
}

export function billSubtotal(items: BillItem[]): number {
  return items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
}

export function billDiscount(items: BillItem[]): number {
  return items.reduce((sum, i) => sum + i.discount, 0);
}

export function billTotal(items: BillItem[]): number {
  return billSubtotal(items) - billDiscount(items);
}

export function formatMoney(amount: number, currency = 'UZS'): string {
  return (
    new Intl.NumberFormat('uz-UZ', {
      style: 'decimal',
      maximumFractionDigits: 0,
    }).format(Math.round(amount)) +
    ' ' +
    currency
  );
}
