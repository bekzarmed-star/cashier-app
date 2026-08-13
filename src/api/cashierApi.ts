import { BMS_API_URL, USE_MOCK } from './config';
import {
  MOCK_BILLS,
  MOCK_DRAWER,
  MOCK_PATIENTS,
  MOCK_TRANSACTIONS,
  MOCK_USERS,
} from '../data/mock';
import type {
  Bill,
  CashDrawerSession,
  CashierUser,
  DashboardStats,
  Patient,
  PaymentSplit,
  Transaction,
} from '../types';
import { billTotal } from '../types';

const STORAGE_TX = 'zph_cashier_transactions';
const STORAGE_BILLS = 'zph_cashier_bills';
const STORAGE_DRAWER = 'zph_cashier_drawer';

function loadTx(): Transaction[] {
  const raw = localStorage.getItem(STORAGE_TX);
  if (raw) return JSON.parse(raw) as Transaction[];
  localStorage.setItem(STORAGE_TX, JSON.stringify(MOCK_TRANSACTIONS));
  return [...MOCK_TRANSACTIONS];
}

function saveTx(list: Transaction[]) {
  localStorage.setItem(STORAGE_TX, JSON.stringify(list));
}

function loadBills(): Bill[] {
  const raw = localStorage.getItem(STORAGE_BILLS);
  if (raw) return JSON.parse(raw) as Bill[];
  localStorage.setItem(STORAGE_BILLS, JSON.stringify(MOCK_BILLS));
  return [...MOCK_BILLS];
}

function saveBills(list: Bill[]) {
  localStorage.setItem(STORAGE_BILLS, JSON.stringify(list));
}

function loadDrawer(): CashDrawerSession {
  const raw = localStorage.getItem(STORAGE_DRAWER);
  if (raw) return JSON.parse(raw) as CashDrawerSession;
  localStorage.setItem(STORAGE_DRAWER, JSON.stringify(MOCK_DRAWER));
  return { ...MOCK_DRAWER };
}

function saveDrawer(d: CashDrawerSession) {
  localStorage.setItem(STORAGE_DRAWER, JSON.stringify(d));
}

async function bmsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BMS_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error || `API ${res.status}: ${path}`);
  }
  return data as T;
}

function delay(ms = 280) {
  return new Promise((r) => setTimeout(r, ms));
}

function receiptNo(): string {
  const n = Math.floor(3100 + Math.random() * 900);
  return `RCP-2026-${n}`;
}

export const cashierApi = {
  async login(username: string, password: string): Promise<CashierUser> {
    if (USE_MOCK) {
      await delay();
      const user = MOCK_USERS.find((u) => u.username === username);
      if (!user || password !== '1234') {
        throw new Error('Invalid username or password');
      }
      return user;
    }
    return bmsFetch<CashierUser>('/api/cashier/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  async register(input: {
    username: string;
    password: string;
    name: string;
    phone?: string;
    counterId?: string;
  }): Promise<CashierUser> {
    if (USE_MOCK) {
      await delay();
      const username = input.username.trim().toLowerCase();
      if (MOCK_USERS.some((u) => u.username === username)) {
        throw new Error('Такой логин уже занят');
      }
      const user: CashierUser = {
        id: `u-mock-${Date.now()}`,
        username,
        name: input.name.trim(),
        role: 'cashier',
        counterId: input.counterId || 'C-01',
        phone: input.phone || '',
        branchCode: '',
        branchLabel: '',
      };
      MOCK_USERS.push(user);
      return user;
    }
    return bmsFetch<CashierUser>('/api/cashier/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async searchPatients(query: string): Promise<Patient[]> {
    if (USE_MOCK) {
      await delay(150);
      const q = query.trim().toLowerCase();
      if (!q) return MOCK_PATIENTS;
      return MOCK_PATIENTS.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.mrn.toLowerCase().includes(q) ||
          (p.phone ?? '').includes(q),
      );
    }
    return bmsFetch<Patient[]>(`/api/cashier/patients?q=${encodeURIComponent(query)}`);
  },

  async getPendingBills(patientId?: string): Promise<Bill[]> {
    if (USE_MOCK) {
      await delay(150);
      const bills = loadBills().filter((b) => b.status === 'pending' || b.status === 'partial');
      return patientId ? bills.filter((b) => b.patient.id === patientId) : bills;
    }
    const qs = patientId ? `?patientId=${patientId}` : '';
    return bmsFetch<Bill[]>(`/api/cashier/bills/pending${qs}`);
  },

  async getBill(billId: string): Promise<Bill | null> {
    if (USE_MOCK) {
      await delay(100);
      return loadBills().find((b) => b.id === billId) ?? null;
    }
    return bmsFetch<Bill>(`/api/cashier/bills/${billId}`);
  },

  async collectPayment(input: {
    billId: string;
    payments: PaymentSplit[];
    amountPaid: number;
    change: number;
    cashier: CashierUser;
    accountCode?: string;
  }): Promise<Transaction> {
    if (USE_MOCK) {
      await delay(400);
      const bills = loadBills();
      const bill = bills.find((b) => b.id === input.billId);
      if (!bill) throw new Error('Bill not found');

      const total = billTotal(bill.items) - bill.paidAmount;
      const paidNow = input.payments.reduce((s, p) => s + p.amount, 0);
      if (paidNow < total - 0.5) {
        bill.paidAmount += paidNow;
        bill.status = 'partial';
      } else {
        bill.paidAmount = billTotal(bill.items);
        bill.status = 'paid';
      }
      saveBills(bills);

      const tx: Transaction = {
        id: `t-${Date.now()}`,
        receiptNo: receiptNo(),
        billId: bill.id,
        invoiceNo: bill.invoiceNo,
        patient: bill.patient,
        items: bill.items,
        payments: input.payments,
        accountCode: input.accountCode,
        subtotal: bill.items.reduce((s, i) => s + i.qty * i.unitPrice, 0),
        discount: bill.items.reduce((s, i) => s + i.discount, 0),
        total: billTotal(bill.items),
        amountPaid: input.amountPaid,
        change: input.change,
        cashierId: input.cashier.id,
        cashierName: input.cashier.name,
        counterId: input.cashier.counterId,
        createdAt: new Date().toISOString(),
        status: 'completed',
      };
      const txs = loadTx();
      txs.unshift(tx);
      saveTx(txs);
      return tx;
    }
    return bmsFetch<Transaction>('/api/cashier/payments', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async getTransactions(filters?: {
    from?: string;
    to?: string;
    query?: string;
  }): Promise<Transaction[]> {
    if (USE_MOCK) {
      await delay(150);
      let list = loadTx();
      const q = filters?.query?.trim().toLowerCase();
      if (q) {
        list = list.filter(
          (t) =>
            t.receiptNo.toLowerCase().includes(q) ||
            t.invoiceNo.toLowerCase().includes(q) ||
            t.patient.name.toLowerCase().includes(q) ||
            t.patient.mrn.toLowerCase().includes(q),
        );
      }
      return list;
    }
    const params = new URLSearchParams(filters as Record<string, string>);
    return bmsFetch<Transaction[]>(`/api/cashier/transactions?${params}`);
  },

  async getDashboardStats(): Promise<DashboardStats> {
    if (USE_MOCK) {
      await delay(120);
      const txs = loadTx().filter((t) => t.status === 'completed');
      const today = new Date().toDateString();
      const todayTx = txs.filter((t) => new Date(t.createdAt).toDateString() === today);
      const sumBy = (method: string) =>
        todayTx.reduce(
          (s, t) => s + t.payments.filter((p) => p.method === method).reduce((a, p) => a + p.amount, 0),
          0,
        );
      return {
        todayCollections: todayTx.reduce((s, t) => s + t.total, 0),
        todayTransactions: todayTx.length,
        cashTotal: sumBy('cash'),
        cardTotal: sumBy('card'),
        transferTotal: sumBy('transfer'),
        insuranceTotal: sumBy('insurance'),
        pendingBills: loadBills().filter((b) => b.status === 'pending' || b.status === 'partial')
          .length,
      };
    }
    return bmsFetch<DashboardStats>('/api/cashier/stats');
  },

  async getDrawerSession(): Promise<CashDrawerSession> {
    if (USE_MOCK) {
      await delay(100);
      return loadDrawer();
    }
    return bmsFetch<CashDrawerSession>('/api/cashier/drawer');
  },

  async openDrawer(cashier: CashierUser, openingFloat: number): Promise<CashDrawerSession> {
    if (USE_MOCK) {
      await delay(200);
      const d: CashDrawerSession = {
        id: `d-${Date.now()}`,
        counterId: cashier.counterId,
        cashierId: cashier.id,
        cashierName: cashier.name,
        openedAt: new Date().toISOString(),
        openingFloat,
        status: 'open',
      };
      saveDrawer(d);
      return d;
    }
    return bmsFetch<CashDrawerSession>('/api/cashier/drawer/open', {
      method: 'POST',
      body: JSON.stringify({ openingFloat, cashier }),
    });
  },

  async closeDrawer(countedCash: number): Promise<CashDrawerSession> {
    if (USE_MOCK) {
      await delay(250);
      const d = loadDrawer();
      const txs = loadTx().filter(
        (t) =>
          t.status === 'completed' &&
          new Date(t.createdAt) >= new Date(d.openedAt),
      );
      const cashCollected = txs.reduce(
        (s, t) => s + t.payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0) - t.change,
        0,
      );
      d.expectedCash = d.openingFloat + cashCollected;
      d.countedCash = countedCash;
      d.variance = countedCash - d.expectedCash;
      d.closedAt = new Date().toISOString();
      d.status = 'closed';
      saveDrawer(d);
      return d;
    }
    return bmsFetch<CashDrawerSession>('/api/cashier/drawer/close', {
      method: 'POST',
      body: JSON.stringify({ countedCash }),
    });
  },

  async updateProfile(input: {
    cashierId: string;
    name: string;
    phone: string;
  }): Promise<CashierUser> {
    if (USE_MOCK) {
      await delay(200);
      return {
        id: input.cashierId,
        name: input.name,
        username: 'cashier',
        role: 'cashier',
        counterId: 'C-01',
        phone: input.phone,
        branchCode: '',
        branchLabel: '',
      };
    }
    return bmsFetch<CashierUser>('/api/cashier/profile', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  async updatePassword(input: {
    cashierId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ ok: boolean }> {
    if (USE_MOCK) {
      await delay(200);
      if (input.currentPassword !== '1234') {
        throw new Error('Текущий пароль неверный');
      }
      return { ok: true };
    }
    return bmsFetch<{ ok: boolean }>('/api/cashier/password', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  /** Reset mock local storage (dev only). */
  resetMockData() {
    localStorage.removeItem(STORAGE_TX);
    localStorage.removeItem(STORAGE_BILLS);
    localStorage.removeItem(STORAGE_DRAWER);
  },
};
