import { BMS_API_URL } from './config';

export interface ErpSyncResult {
  ok: boolean;
  count: number;
  invoiceCount: number;
  tripCount: number;
  file: {
    id: string;
    name: string;
    headers: string[];
    data: (string | number | null)[][];
    updatedAt: string;
  };
  invoices: { skipped?: boolean; reason?: string; totalFetched?: number };
  trips: { skipped?: boolean; reason?: string; totalFetched?: number };
  config: {
    baseUrl: string;
    hasApiKey: boolean;
    hasInvoiceAuth: boolean;
  };
}

export interface ErpHealth {
  ok: boolean;
  baseUrl: string;
  apiKeyConfigured: boolean;
  invoiceAuthConfigured: boolean;
  writeAuthConfigured?: boolean;
  trips: { ok: boolean; total?: number; error?: string; skipped?: boolean } | null;
  invoices: { ok: boolean; total?: number; error?: string; endpoint?: string } | null;
}

export interface ErpInvoiceBasisLine {
  name: string;
  unit: string;
  qty: number;
  price: number;
  total: number;
}

export interface ErpInvoiceApprover {
  index: number;
  label: string;
  role: string;
  name: string;
  approvedByName: string;
  isApproved: boolean;
  isRejected: boolean;
  approvedAt: string | null;
  rejectedAt: string | null;
  signature: string;
  rejectionComment: string;
}

export interface ErpInvoice {
  id: string;
  regNo: string;
  regDate: string;
  status: string;
  statusRu: string;
  payType: string;
  payTypeRu: string;
  branch: string;
  branchCode: string;
  currency: string;
  amount: number;
  sumInWords: string;
  explanation: string;
  title: string;
  initiator: string;
  initiatorDept: string;
  initiatorDate?: string;
  initiatorSignature?: string;
  recipient: string;
  paymentBasis: ErpInvoiceBasisLine[];
  approvers?: ErpInvoiceApprover[];
  confirmation?: {
    confirmed: boolean;
    confirmedBy: string | null;
    confirmedAt: string | null;
    fullyConfirmed: boolean;
  } | null;
  cashierReceived: { received: boolean; receivedAt: string | null; receivedBy: string };
  bankReceived: { received: boolean; receivedAt: string | null; receivedBy: string };
  needsCashier: boolean;
  awaitAccept?: boolean;
  localAccepted?: boolean;
  localAcceptance?: {
    cashierId: string;
    cashierName: string;
    note: string;
    erpPushed: boolean;
    erpPushError: string;
    acceptedAt: string;
  } | null;
}

export type ErpInvoiceTab = 'awaiting' | 'accepted' | 'all';

export interface ErpInvoiceList {
  items: ErpInvoice[];
  total: number;
  limit: number;
  offset: number;
  tab?: ErpInvoiceTab;
  erpApprovedApprox?: number;
}

export const erpApi = {
  async health() {
    const res = await fetch(`${BMS_API_URL}/api/cashier/erp/health`);
    const data = (await res.json().catch(() => ({}))) as ErpHealth & { error?: string };
    if (!res.ok && !data.baseUrl) throw new Error(data.error || `ERP health ${res.status}`);
    return data;
  },

  async sync(cashier?: { id: string; name: string }) {
    const res = await fetch(`${BMS_API_URL}/api/cashier/erp/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cashier }),
    });
    const data = (await res.json().catch(() => ({}))) as ErpSyncResult & { error?: string };
    if (!res.ok) throw new Error(data.error || `ERP sync ${res.status}`);
    return data as ErpSyncResult;
  },

  async listInvoices(params: {
    tab?: ErpInvoiceTab;
    q?: string;
    branch?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const qs = new URLSearchParams();
    if (params.tab) qs.set('tab', params.tab);
    if (params.q) qs.set('q', params.q);
    if (params.branch) qs.set('branch', params.branch);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : '';
    const res = await fetch(`${BMS_API_URL}/api/cashier/erp/invoices${suffix}`);
    const data = (await res.json().catch(() => ({}))) as ErpInvoiceList & { error?: string };
    if (!res.ok) throw new Error(data.error || `ERP invoices ${res.status}`);
    return data;
  },

  async getInvoice(id: string) {
    const res = await fetch(`${BMS_API_URL}/api/cashier/erp/invoices/${encodeURIComponent(id)}`);
    const data = (await res.json().catch(() => ({}))) as ErpInvoice & { error?: string };
    if (!res.ok) throw new Error(data.error || `ERP invoice ${res.status}`);
    return data;
  },

  async acceptInvoice(
    id: string,
    body: { cashier: { id: string; name: string }; note?: string },
  ) {
    const res = await fetch(
      `${BMS_API_URL}/api/cashier/erp/invoices/${encodeURIComponent(id)}/accept`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      invoice?: ErpInvoice;
      erpPush?: { ok: boolean; skipped?: boolean; reason?: string };
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || `Accept ${res.status}`);
    return data;
  },

  async pushInvoiceToErp(id: string, cashier?: { id: string; name: string }) {
    const res = await fetch(
      `${BMS_API_URL}/api/cashier/erp/invoices/${encodeURIComponent(id)}/push-erp`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cashier }),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      erpPush?: { ok: boolean; reason?: string };
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || `ERP push ${res.status}`);
    return data;
  },
};
