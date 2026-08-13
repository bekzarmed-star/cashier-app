/**
 * ERP (BMS) client — confirmed invoices + optional business-trips.
 * Auth: X-API-Key on /api/v1/* (from ERP_API_KEY in .env).
 */

const BRANCH_LABELS = {
  bukhara: 'Бухара',
  shahrisabz: 'Шахрисабз',
  karshi: 'Карши',
  samarkand: 'Самарканд',
};

const TRIP_STATUS_RU = {
  pending_leader: 'Ожидает подписи руководителя',
  leader_signed: 'Согласовано руководителем → касса',
  pending_cashier: 'В очереди кассы',
  completed: 'Завершено',
  step2_pending: '2-этап на согласовании',
  step2_cashier: '2-этап в очереди кассы',
  step2_approved: '2-этап согласован',
  step3_pending: '3-этап на подписи',
  step3_completed: 'Командировка завершена',
};

/** Flat confirmed-invoice columns → Excel */
const ERP_HEADERS = [
  'Рег. №',
  'Дата',
  'Инициатор',
  'Наименование',
  'Сумма',
  'Статус',
  'Филиал',
  'Форма оплаты',
  'Касса',
  'Отдел',
  'Основание',
  'Валюта',
  'Получено',
  'Источник',
  'ERP ID',
];

export { ERP_HEADERS, BRANCH_LABELS, TRIP_STATUS_RU };

function erpConfig() {
  return {
    baseUrl: (process.env.ERP_BASE_URL || 'http://159.223.235.20:4001').replace(/\/$/, ''),
    apiKey: process.env.ERP_API_KEY || '',
    /** Static Bearer (ERP UI token) — optional if login phone/password set */
    bearerToken: process.env.ERP_BEARER_TOKEN || '',
    /** ERP account that can mark «Получено кассой» (role: cashier / bank / admin) */
    loginPhone: process.env.ERP_LOGIN_PHONE || process.env.ERP_LOGIN_USERNAME || '',
    loginPassword: process.env.ERP_LOGIN_PASSWORD || '',
    /** If true (default), accept fails when ERP kassa mark cannot be written */
    requirePush: String(process.env.ERP_REQUIRE_PUSH || 'true').toLowerCase() !== 'false',
    syncInvoices: String(process.env.ERP_SYNC_INVOICES || 'true').toLowerCase() !== 'false',
    syncTrips: String(process.env.ERP_SYNC_TRIPS || 'false').toLowerCase() === 'true',
    invoiceLimit: Math.min(Number(process.env.ERP_INVOICE_LIMIT || 2000) || 2000, 5000),
    invoicePageSize: Math.min(Number(process.env.ERP_INVOICE_PAGE_SIZE || 100) || 100, 500),
  };
}

/** Cached ERP session for write-back */
let erpSession = {
  token: '',
  role: '',
  name: '',
  expiresAt: 0,
};

function parseMoney(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/сум|uzs|sum/gi, '');
  if (!s) return 0;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    return Number(s.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (/^\d+,\d+$/.test(s)) return Number(s.replace(',', '.')) || 0;
  if (/^\d+\.\d{3}$/.test(s) && !s.includes(',')) {
    return Number(s.replace(/\./g, '')) || 0;
  }
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function pick(row, ...keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return row[key];
  }
  return '';
}

/** Map «Форма оплаты» / «Получено» → С кассой / Без кассы */
function cashLabelFromFlat(row) {
  const form = String(pick(row, 'Форма оплаты')).toLowerCase();
  const received = String(pick(row, 'Получено')).toLowerCase();
  const blob = `${form} ${received}`;

  const isCash =
    blob.includes('налич') || blob.includes('касс') || form.includes('cash');
  const isBank =
    blob.includes('безналич') || blob.includes('банк') || form.includes('bank');

  if (isCash && isBank) return 'Касса / Банк';
  if (isCash) return 'С кассой';
  if (isBank) return 'Без кассы';
  return pick(row, 'Форма оплаты') || '—';
}

function branchLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  const key = raw.toLowerCase();
  return BRANCH_LABELS[key] || raw;
}

async function erpFetch(path, { method = 'GET', headers = {}, body } = {}) {
  const cfg = erpConfig();
  if (!cfg.apiKey) {
    const err = new Error('ERP_API_KEY is not configured');
    err.status = 500;
    throw err;
  }

  const url = `${cfg.baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'X-API-Key': cfg.apiKey,
      ...headers,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const err = new Error(`ERP returned non-JSON (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(data.error || data.detail || data.hint || `ERP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Flat confirmed invoice row → Excel row object */
export function mapConfirmedFlatRow(row) {
  const amountRaw = pick(row, 'Сумма');
  const amount = typeof amountRaw === 'number' ? amountRaw : parseMoney(amountRaw);

  return {
    regNo: String(pick(row, 'Рег. №')),
    date: String(pick(row, 'Дата')).slice(0, 10),
    initiator: String(pick(row, 'Инициатор')),
    title: String(pick(row, 'Наименование')),
    amount,
    status: String(pick(row, 'Статус') || 'Согласовано'),
    branch: branchLabel(pick(row, 'Филиал')),
    payForm: String(pick(row, 'Форма оплаты')),
    cash: cashLabelFromFlat(row),
    dept: String(pick(row, 'Отдел')),
    basis: String(pick(row, 'Основание')),
    currency: String(pick(row, 'Валюта') || 'sum'),
    received: String(pick(row, 'Получено')),
    source: 'invoice',
    erpId: String(pick(row, 'Внутр. ID')),
  };
}

export function mapTripRow(trip) {
  const form = trip.form || {};
  const amount =
    parseMoney(form.advanceAmount) ||
    parseMoney(form.dailyAllowanceTotal) +
      parseMoney(form.transportPrice) +
      parseMoney(form.transportReturnPrice) +
      parseMoney(form.bonusAmount);

  const hasCashier =
    !!trip.signatures?.cashier ||
    !!String(form.cashierFio || '').trim() ||
    ['pending_cashier', 'step2_cashier'].includes(trip.status);

  return {
    regNo: trip.regNo || '',
    date: form.dateFrom || (trip.createdAt || '').slice(0, 10),
    initiator: trip.employee?.name || form.employeeFio || form.sentBy || '',
    title: form.tripPurpose || '',
    amount,
    status: TRIP_STATUS_RU[trip.status] || trip.status || '',
    branch: form.destinationCity || '—',
    payForm: hasCashier ? 'Касса' : '—',
    cash: hasCashier ? 'С кассой' : 'Без кассы',
    dept: trip.employee?.position || form.position || '',
    basis: '',
    currency: 'sum',
    received: '',
    source: 'business-trip',
    erpId: trip.id || '',
  };
}

/**
 * Confirmed invoices («Согласовано») — primary ERP source.
 * GET /api/v1/invoices/confirmed?shape=flat
 */
export async function fetchApprovedInvoices() {
  const cfg = erpConfig();
  if (!cfg.syncInvoices) return { rows: [], skipped: true, reason: 'ERP_SYNC_INVOICES=false' };

  try {
    const pageSize = cfg.invoicePageSize;
    const max = cfg.invoiceLimit;
    const all = [];

    for (let offset = 0; offset < max; offset += pageSize) {
      const q = new URLSearchParams({
        shape: 'flat',
        limit: String(pageSize),
        offset: String(offset),
      });
      const data = await erpFetch(`/api/v1/invoices/confirmed?${q}`);
      const batch = Array.isArray(data?.data) ? data.data : [];
      all.push(...batch);

      const total = Number(data?.meta?.total ?? all.length);
      if (all.length >= total || batch.length < pageSize || all.length >= max) break;
    }

    const rows = all.slice(0, max).map(mapConfirmedFlatRow);
    return {
      rows,
      skipped: false,
      totalFetched: all.length,
      totalAvailable: undefined,
    };
  } catch (err) {
    return {
      rows: [],
      skipped: true,
      reason: err.message,
      status: err.status,
    };
  }
}

/** Optional: agreed business trips (off by default — invoices are primary). */
export async function fetchAgreedBusinessTrips() {
  const cfg = erpConfig();
  if (!cfg.syncTrips) return { rows: [], skipped: true, reason: 'ERP_SYNC_TRIPS=false' };

  const agreed = new Set(['leader_signed', 'pending_cashier', 'step2_cashier', 'step2_approved']);
  try {
    const pageSize = 100;
    const all = [];
    for (let offset = 0; ; offset += pageSize) {
      const data = await erpFetch(`/api/v1/business-trips?limit=${pageSize}&offset=${offset}`);
      const batch = Array.isArray(data?.data) ? data.data : [];
      all.push(...batch);
      const total = Number(data?.meta?.total ?? all.length);
      if (all.length >= total || batch.length < pageSize) break;
    }
    const rows = all.filter((t) => agreed.has(t.status)).map(mapTripRow);
    return { rows, skipped: false, totalFetched: all.length };
  } catch (err) {
    return {
      rows: [],
      skipped: true,
      reason: err.message,
      status: err.status,
    };
  }
}

export async function collectErpRows() {
  const [invoices, trips] = await Promise.all([fetchApprovedInvoices(), fetchAgreedBusinessTrips()]);
  const rows = [...invoices.rows, ...trips.rows];
  rows.sort(
    (a, b) =>
      String(b.date).localeCompare(String(a.date)) || String(a.regNo).localeCompare(String(b.regNo)),
  );
  return {
    rows,
    invoices,
    trips,
    config: {
      baseUrl: erpConfig().baseUrl,
      hasApiKey: Boolean(erpConfig().apiKey),
      invoiceEndpoint: '/api/v1/invoices/cashier-queue',
    },
  };
}

export function rowsToSheet(rows) {
  const data = rows.map((r) => [
    r.regNo,
    r.date,
    r.initiator,
    r.title,
    r.amount || null,
    r.status,
    r.branch,
    r.payForm || '',
    r.cash,
    r.dept || '',
    r.basis || '',
    r.currency || '',
    r.received || '',
    r.source,
    r.erpId,
  ]);
  while (data.length < 20) {
    data.push(['', '', '', '', null, '', '', '', '', '', '', '', '', '', '']);
  }
  return { headers: [...ERP_HEADERS], data };
}

/** Full ERP invoice → cashier-friendly object */
export function mapErpInvoice(inv) {
  const basis = Array.isArray(inv.paymentBasis) ? inv.paymentBasis : [];
  const titleFromBasis = basis
    .map((b) => String(b?.name || '').trim())
    .filter(Boolean)
    .join('; ');
  const initiator = inv.initiator || {};
  const createdBy = inv.createdBy || {};
  const conf = inv.confirmation && typeof inv.confirmation === 'object' ? inv.confirmation : null;
  const confCash = conf?.cashier && typeof conf.cashier === 'object' ? conf.cashier : null;
  const cashierRecvRaw =
    inv.cashierReceived && typeof inv.cashierReceived === 'object' ? inv.cashierReceived : null;
  const bankRecv = inv.bankReceived && typeof inv.bankReceived === 'object' ? inv.bankReceived : null;
  const payType = String(inv.payType || 'unset');

  const cashierReceived = {
    received: Boolean(cashierRecvRaw?.received || confCash?.received),
    receivedAt: cashierRecvRaw?.receivedAt || confCash?.receivedAt || null,
    receivedBy: String(cashierRecvRaw?.receivedBy || confCash?.receivedBy || ''),
  };

  return {
    id: String(inv.id || ''),
    regNo: String(inv.regNo || ''),
    regDate: String(inv.regDate || '').slice(0, 10),
    status: String(inv.status || ''),
    statusRu: String(inv.statusRu || inv.status || ''),
    payType,
    payTypeRu: String(inv.payTypeRu || payType),
    branch: branchLabel(inv.invoiceBranchRu || inv.invoiceBranch),
    branchCode: String(inv.invoiceBranch || ''),
    currency: String(inv.currency || 'sum'),
    amount: parseMoney(inv.paymentAmount),
    sumInWords: String(inv.sumInWords || ''),
    explanation: String(inv.paymentAmountExplanation || ''),
    title: titleFromBasis || String(inv.paymentAmountExplanation || '—'),
    initiator: String(initiator.name || createdBy.name || ''),
    initiatorDept: String(initiator.dept || createdBy.department || ''),
    initiatorDate: String(initiator.date || '').slice(0, 10),
    initiatorSignature: typeof initiator.signature === 'string' ? initiator.signature : '',
    recipient: String(inv.recipient?.name || inv.recipient?.nameInn || ''),
    paymentBasis: basis
      .filter((b) => String(b?.name || '').trim())
      .map((b) => ({
        name: String(b.name || ''),
        unit: String(b.unit || ''),
        qty: Number(b.qty) || 0,
        price: parseMoney(b.price),
        total: parseMoney(b.total),
      })),
    approvers: (Array.isArray(inv.approvers) ? inv.approvers : []).map((a, index) => ({
      index,
      label: `L${index + 1}`,
      role: String(a?.role || ''),
      name: String(a?.name || ''),
      approvedByName: String(a?.approvedByName || a?.name || ''),
      isApproved: Boolean(a?.isApproved),
      isRejected: Boolean(a?.isRejected),
      approvedAt: a?.approvedAt ? String(a.approvedAt) : null,
      rejectedAt: a?.rejectedAt ? String(a.rejectedAt) : null,
      signature: typeof a?.signature === 'string' ? a.signature : '',
      rejectionComment: String(a?.rejectionComment || ''),
    })),
    confirmation: conf
      ? {
          confirmed: Boolean(conf.confirmed),
          confirmedBy: conf.confirmedBy || null,
          confirmedAt: conf.confirmedAt || null,
          fullyConfirmed: Boolean(conf.fullyConfirmed),
        }
      : null,
    cashierReceived,
    bankReceived: bankRecv
      ? {
          received: Boolean(bankRecv.received),
          receivedAt: bankRecv.receivedAt || null,
          receivedBy: bankRecv.receivedBy || '',
        }
      : { received: false, receivedAt: null, receivedBy: '' },
    needsCashier:
      ['Approved', 'Archived', 'Sent to Feeds'].includes(String(inv.status)) &&
      (payType === 'Cash' || payType === 'Both') &&
      !cashierReceived.received,
  };
}

/**
 * Official ERP cashier queue (Cash/Both awaiting касса).
 * GET /api/v1/invoices/cashier-queue
 */
export async function fetchCashierQueue({ limit = 100, offset = 0, q = '' } = {}) {
  const pageSize = Math.min(Number(limit) || 100, 200);
  const start = Math.max(Number(offset) || 0, 0);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String(start),
  });
  if (q) params.set('q', q);

  const data = await erpFetch(`/api/v1/invoices/cashier-queue?${params}`);
  const items = Array.isArray(data?.data) ? data.data.map(mapErpInvoice) : [];
  return {
    items,
    total: Number(data?.meta?.total ?? items.length),
    limit: Number(data?.meta?.limit ?? pageSize),
    offset: Number(data?.meta?.offset ?? start),
    acceptEndpoint: data?.meta?.acceptEndpoint || 'POST /api/v1/invoices/{id}/cashier-accept',
  };
}

/**
 * List invoices from ERP integration API.
 * GET /api/v1/invoices?status&limit&offset&q
 */
export async function fetchErpInvoices({
  status = '',
  limit = 100,
  offset = 0,
  q = '',
} = {}) {
  const pageSize = Math.min(Number(limit) || 100, 200);
  const start = Math.max(Number(offset) || 0, 0);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String(start),
  });
  if (status) params.set('status', status);
  if (q) params.set('q', q);

  const data = await erpFetch(`/api/v1/invoices?${params}`);
  const items = Array.isArray(data?.data) ? data.data.map(mapErpInvoice) : [];
  return {
    items,
    total: Number(data?.meta?.total ?? items.length),
    limit: pageSize,
    offset: start,
  };
}

/** Fetch one invoice by id */
export async function fetchErpInvoiceById(id) {
  const data = await erpFetch(`/api/v1/invoices/${encodeURIComponent(id)}`);
  const inv = data?.data || data;
  if (!inv?.id) {
    const err = new Error('Счёт ERP не найден');
    err.status = 404;
    throw err;
  }
  return mapErpInvoice(inv);
}

/** Raw invoice object from ERP (for write-back). */
async function fetchRawErpInvoice(id) {
  const data = await erpFetch(`/api/v1/invoices/${encodeURIComponent(id)}`);
  const inv = data?.data || data;
  if (!inv?.id) {
    const err = new Error('Счёт ERP не найден');
    err.status = 404;
    throw err;
  }
  return inv;
}

/**
 * Login to ERP UI API → Bearer token (needed to set cashierReceived / kassa symbol).
 * POST /api/auth/login  { phone|username, password }
 */
export async function erpLogin({ force = false } = {}) {
  const cfg = erpConfig();
  const now = Date.now();
  if (!force && erpSession.token && erpSession.expiresAt > now + 30_000) {
    return { ok: true, token: erpSession.token, cached: true, role: erpSession.role };
  }
  if (cfg.bearerToken) {
    erpSession = {
      token: cfg.bearerToken,
      role: 'token',
      name: '',
      expiresAt: now + 12 * 60 * 60 * 1000,
    };
    return { ok: true, token: cfg.bearerToken, cached: false, role: 'token' };
  }
  if (!cfg.loginPhone || !cfg.loginPassword) {
    return {
      ok: false,
      reason:
        'Нет доступа к ERP для записи кассы. Укажите ERP_LOGIN_PHONE + ERP_LOGIN_PASSWORD (аккаунт кассира ERP) или ERP_BEARER_TOKEN.',
    };
  }

  const looksLikePhone = /^\+?\d{7,15}$/.test(String(cfg.loginPhone).replace(/\s/g, ''));
  const body = looksLikePhone
    ? { phone: String(cfg.loginPhone).replace(/\s/g, ''), password: cfg.loginPassword }
    : { username: String(cfg.loginPhone).trim(), password: cfg.loginPassword };

  const url = `${cfg.baseUrl}/api/auth/login`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    return {
      ok: false,
      reason: data.error || data.detail || `ERP login failed (${res.status})`,
      status: res.status,
    };
  }

  erpSession = {
    token: data.token,
    role: data.role || '',
    name: data.name || data.username || '',
    expiresAt: now + 10 * 60 * 60 * 1000,
  };
  return { ok: true, token: data.token, cached: false, role: erpSession.role, name: erpSession.name };
}

/** Shape payload like ERP UI Ale() — keep cashierReceived for kassa symbol. */
function buildCashierReceivedPayload(inv, { receivedBy, receivedAt }) {
  const initiator = inv.initiator || {};
  const recipient = inv.recipient || {};
  const finance = inv.finance || {};
  const createdBy = inv.createdBy || {};
  const requestInfo = inv.requestInfo || { no: '', date: '' };
  const cashier = inv.cashier || {};

  const payload = {
    id: String(inv.id || ''),
    regNo: typeof inv.regNo === 'string' ? inv.regNo : '',
    regDate: typeof inv.regDate === 'string' ? inv.regDate : '',
    status: inv.status,
    approvers: Array.isArray(inv.approvers) ? inv.approvers : [],
    initiator: {
      dept: initiator.dept || '',
      role: initiator.role || '',
      name: initiator.name || '',
      ...(initiator.employeeId ? { employeeId: initiator.employeeId } : {}),
      ...(initiator.signature ? { signature: initiator.signature } : {}),
      ...(initiator.date ? { date: initiator.date } : {}),
    },
    requestInfo: {
      no: requestInfo.no || '',
      date: requestInfo.date || '',
    },
    paymentBasis: Array.isArray(inv.paymentBasis) ? inv.paymentBasis : [],
    payType: inv.payType,
    sumInWords: typeof inv.sumInWords === 'string' ? inv.sumInWords : '',
    finance: {
      contractTotal: Number(finance.contractTotal) || 0,
      prevSum: Number(finance.prevSum) || 0,
      currentSum: Number(finance.currentSum) || 0,
      totalSum: Number(finance.totalSum) || 0,
      balance: Number(finance.balance) || 0,
    },
    recipient: {
      nameInn: recipient.nameInn || '',
      bankName: recipient.bankName || '',
      mfo: recipient.mfo || '',
      account: recipient.account || '',
      additional: recipient.additional || '',
      ...(recipient.address ? { address: recipient.address } : {}),
    },
    cashier: {
      name: receivedBy || cashier.name || 'Касса',
      date: String(receivedAt || new Date().toISOString()).slice(0, 10),
    },
    docs: Array.isArray(inv.docs) ? inv.docs : [],
    docFiles: Array.isArray(inv.docFiles) ? inv.docFiles : [],
    cashierReceived: {
      received: true,
      receivedAt: receivedAt || new Date().toISOString(),
      receivedBy: receivedBy || 'Касса',
    },
  };

  if (inv.bankReceived && typeof inv.bankReceived === 'object') {
    payload.bankReceived = {
      received: !!inv.bankReceived.received,
      ...(typeof inv.bankReceived.receivedAt === 'string'
        ? { receivedAt: inv.bankReceived.receivedAt }
        : {}),
      ...(typeof inv.bankReceived.receivedBy === 'string'
        ? { receivedBy: inv.bankReceived.receivedBy }
        : {}),
    };
  }
  if (inv.invoiceFormat) payload.invoiceFormat = inv.invoiceFormat;
  if (inv.invoiceBranch) payload.invoiceBranch = inv.invoiceBranch;
  if (inv.currency) payload.currency = inv.currency;
  if (inv.paymentTotalOverride != null) payload.paymentTotalOverride = inv.paymentTotalOverride;
  if (typeof inv.paymentAmountExplanation === 'string') {
    payload.paymentAmountExplanation = inv.paymentAmountExplanation.slice(0, 8000);
  }
  if (inv.isArchived != null) payload.isArchived = !!inv.isArchived;
  if (typeof inv.archivedAt === 'string') payload.archivedAt = inv.archivedAt;
  if (typeof inv.archivedBy === 'string') payload.archivedBy = inv.archivedBy;
  if (inv.escalatedToLeader34 != null) payload.escalatedToLeader34 = !!inv.escalatedToLeader34;
  if (typeof inv.submittedAt === 'string') payload.submittedAt = inv.submittedAt;
  if (createdBy && typeof createdBy === 'object') {
    payload.createdBy = {
      ...(createdBy.name ? { name: createdBy.name } : {}),
      ...(createdBy.employeeId ? { employeeId: createdBy.employeeId } : {}),
      ...(createdBy.department ? { department: createdBy.department } : {}),
    };
  }
  if (Array.isArray(inv.basisDocs)) payload.basisDocs = inv.basisDocs;
  if (Array.isArray(inv.basisDocFiles)) payload.basisDocFiles = inv.basisDocFiles;
  if (inv.folder && typeof inv.folder === 'object') payload.folder = inv.folder;
  if (inv.procurementApproval) payload.procurementApproval = inv.procurementApproval;

  return payload;
}

async function postInvoiceToErp(token, payload) {
  const cfg = erpConfig();
  const url = `${cfg.baseUrl}/api/invoices`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { res, body };
}

/**
 * Mark «Получено кассой» in ERP (same as ERP UI checkbox / Nexus «Касса» badge).
 * Preferred: POST /api/v1/invoices/{id}/cashier-accept with X-API-Key.
 * Fallback: session login + invoice rewrite (legacy).
 */
export async function pushCashierReceivedToErp(invoiceId, { receivedBy, receivedAt }) {
  const cfg = erpConfig();
  if (!cfg.apiKey) {
    return { ok: false, skipped: true, reason: 'ERP_API_KEY is not configured' };
  }

  // 1) Official integration accept endpoint
  try {
    const data = await erpFetch(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/cashier-accept`, {
      method: 'POST',
      body: {
        ...(receivedBy ? { receivedBy } : {}),
        ...(receivedAt ? { receivedAt } : {}),
      },
    });

    if (data?.ok || data?.alreadyAccepted || data?.data?.id) {
      return {
        ok: true,
        skipped: false,
        alreadyMarked: Boolean(data?.alreadyAccepted),
        via: 'cashier-accept',
        message: data?.message || '',
      };
    }
  } catch (err) {
    // Fall through to legacy path if endpoint missing / auth differs
    if (err.status && err.status !== 404 && err.status !== 405) {
      // Still try legacy for 401/403 if session write is configured
      if (![401, 403].includes(err.status)) {
        return {
          ok: false,
          skipped: false,
          reason: err.message || `cashier-accept ${err.status}`,
          status: err.status,
        };
      }
    }
  }

  // 2) Legacy: Bearer session rewrite
  const login = await erpLogin();
  if (!login.ok) {
    return { ok: false, skipped: true, reason: login.reason };
  }

  let inv;
  try {
    inv = await fetchRawErpInvoice(invoiceId);
  } catch (err) {
    return { ok: false, skipped: false, reason: err.message || 'Invoice not found in ERP' };
  }

  if (inv.cashierReceived?.received || inv.confirmation?.cashier?.received) {
    return { ok: true, skipped: false, alreadyMarked: true, via: 'legacy-check' };
  }

  const payload = buildCashierReceivedPayload(inv, { receivedBy, receivedAt });

  let { res, body } = await postInvoiceToErp(login.token, payload);

  if (res.status === 401) {
    const again = await erpLogin({ force: true });
    if (!again.ok) {
      return { ok: false, skipped: false, reason: again.reason, status: 401 };
    }
    ({ res, body } = await postInvoiceToErp(again.token, payload));
  }

  if (!res.ok) {
    return {
      ok: false,
      skipped: false,
      reason: body.error || body.detail || body.message || `ERP write ${res.status}`,
      status: res.status,
    };
  }

  return { ok: true, skipped: false, via: 'legacy-session' };
}

export async function erpHealth() {
  const cfg = erpConfig();
  const result = {
    ok: false,
    baseUrl: cfg.baseUrl,
    apiKeyConfigured: Boolean(cfg.apiKey),
    invoiceAuthConfigured: Boolean(cfg.apiKey),
    writeAuthConfigured: Boolean(cfg.bearerToken || (cfg.loginPhone && cfg.loginPassword)),
    writeLoginConfigured: Boolean(cfg.loginPhone && cfg.loginPassword),
    requirePush: cfg.requirePush,
    trips: null,
    invoices: null,
  };

  if (!cfg.apiKey) {
    result.invoices = { ok: false, error: 'ERP_API_KEY missing' };
    result.trips = { ok: false, error: 'ERP_API_KEY missing' };
    return result;
  }

  try {
    const data = await erpFetch('/api/v1/invoices/cashier-queue?limit=1');
    result.invoices = {
      ok: true,
      total: Number(data?.meta?.total ?? 0),
      endpoint: '/api/v1/invoices/cashier-queue',
      acceptEndpoint: data?.meta?.acceptEndpoint || 'POST /api/v1/invoices/{id}/cashier-accept',
    };
  } catch (err) {
    result.invoices = { ok: false, error: err.message };
  }

  if (cfg.syncTrips) {
    try {
      const data = await erpFetch('/api/v1/business-trips?limit=1');
      result.trips = { ok: true, total: Number(data?.meta?.total ?? 0) };
    } catch (err) {
      result.trips = { ok: false, error: err.message };
    }
  } else {
    result.trips = { ok: true, skipped: true, error: 'disabled (ERP_SYNC_TRIPS=false)' };
  }

  result.ok = Boolean(result.invoices?.ok);
  return result;
}
