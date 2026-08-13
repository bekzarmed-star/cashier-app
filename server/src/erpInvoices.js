/**
 * Cashier ERP invoice queue — accept («Получено кассой») like the ERP UI.
 */
import { query } from './db.js';
import {
  fetchCashierQueue,
  fetchErpInvoiceById,
  fetchErpInvoices,
  pushCashierReceivedToErp,
} from './erpApi.js';

function requireErpPush() {
  return String(process.env.ERP_REQUIRE_PUSH || 'true').toLowerCase() !== 'false';
}

const CASHIER_STATUSES = ['Approved', 'Archived', 'Sent to Feeds'];

async function localAcceptanceMap(ids = []) {
  if (!ids.length) return new Map();
  try {
    const { rows } = await query(
      `SELECT erp_id, cashier_id, cashier_name, note, erp_pushed, erp_push_error, accepted_at
       FROM erp_invoice_acceptances
       WHERE erp_id = ANY($1::text[])`,
      [ids],
    );
    return new Map(rows.map((r) => [r.erp_id, r]));
  } catch (err) {
    if (String(err.message).includes('erp_invoice_acceptances')) return new Map();
    throw err;
  }
}

function attachLocal(item, local) {
  if (!local) {
    return {
      ...item,
      localAccepted: false,
      localAcceptance: null,
      awaitAccept: item.needsCashier,
    };
  }
  return {
    ...item,
    needsCashier: false,
    awaitAccept: false,
    localAccepted: true,
    localAcceptance: {
      cashierId: local.cashier_id,
      cashierName: local.cashier_name,
      note: local.note,
      erpPushed: local.erp_pushed,
      erpPushError: local.erp_push_error,
      acceptedAt: local.accepted_at,
    },
    cashierReceived: {
      received: true,
      receivedAt: local.accepted_at,
      receivedBy: local.cashier_name || 'Касса',
    },
  };
}

/**
 * Queue for cashier: uses ERP GET /api/v1/invoices/cashier-queue
 * (Cash/Both awaiting «Получено кассой»). Falls back to Approved scan if needed.
 */
export async function listCashierInvoiceQueue({
  tab = 'awaiting',
  q = '',
  branch = '',
  limit = 50,
  offset = 0,
  scanLimit = 800,
} = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const branchNeedle = String(branch || '').trim().toLowerCase();
  const pageSize = Math.min(Number(limit) || 50, 100);
  const start = Math.max(Number(offset) || 0, 0);
  const maxScan = Math.min(Number(scanLimit) || 800, 2000);

  if (tab === 'accepted') {
    return listLocalAcceptances({ q: needle, branch: branchNeedle, limit: pageSize, offset: start });
  }

  let unique = [];
  let erpTotal = 0;
  let usedDedicatedQueue = false;

  try {
    const collected = [];
    for (let off = 0; off < maxScan; off += 100) {
      const page = await fetchCashierQueue({
        limit: 100,
        offset: off,
        q: needle && !branchNeedle ? needle : '',
      });
      erpTotal = Math.max(erpTotal, page.total);
      collected.push(...page.items);
      usedDedicatedQueue = true;
      if (collected.length >= page.total || page.items.length < 100) break;
    }
    const byId = new Map();
    for (const item of collected) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    unique = [...byId.values()];
  } catch (err) {
    console.warn('[erp-invoices] cashier-queue failed, fallback scan:', err.message);
    const collected = [];
    for (const status of CASHIER_STATUSES) {
      for (let off = 0; off < maxScan && collected.length < maxScan; off += 100) {
        const page = await fetchErpInvoices({ status, limit: 100, offset: off });
        erpTotal = Math.max(erpTotal, page.total);
        if (!page.items.length) break;
        for (const item of page.items) {
          const payOk = item.payType === 'Cash' || item.payType === 'Both';
          if (!payOk) continue;
          collected.push(item);
        }
        if (page.items.length < 100 || off + 100 >= page.total) break;
      }
    }
    const byId = new Map();
    for (const item of collected) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    unique = [...byId.values()];
  }

  const locals = await localAcceptanceMap(unique.map((i) => i.id));
  let merged = unique.map((i) => attachLocal(i, locals.get(i.id)));

  if (tab === 'awaiting') {
    // Dedicated queue already excludes ERP-accepted; also hide locally accepted
    merged = merged.filter((i) => i.awaitAccept);
  }

  if (needle) {
    merged = merged.filter(
      (i) =>
        i.regNo.toLowerCase().includes(needle) ||
        i.initiator.toLowerCase().includes(needle) ||
        i.title.toLowerCase().includes(needle) ||
        i.recipient.toLowerCase().includes(needle) ||
        i.id.toLowerCase().includes(needle),
    );
  }
  if (branchNeedle) {
    merged = merged.filter(
      (i) =>
        i.branchCode.toLowerCase() === branchNeedle ||
        i.branch.toLowerCase().includes(branchNeedle),
    );
  }

  merged.sort(
    (a, b) =>
      String(b.regDate).localeCompare(String(a.regDate)) ||
      String(b.regNo).localeCompare(String(a.regNo)),
  );

  return {
    items: merged.slice(start, start + pageSize),
    total: merged.length,
    limit: pageSize,
    offset: start,
    erpApprovedApprox: erpTotal,
    source: usedDedicatedQueue ? 'cashier-queue' : 'approved-scan',
    tab,
  };
}

async function listLocalAcceptances({ q = '', branch = '', limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(
      LOWER(reg_no) LIKE $${params.length} OR
      LOWER(initiator) LIKE $${params.length} OR
      LOWER(title) LIKE $${params.length} OR
      LOWER(erp_id) LIKE $${params.length}
    )`);
  }
  if (branch) {
    params.push(`%${branch}%`);
    where.push(`LOWER(branch) LIKE $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  let rows = [];
  let total = 0;
  try {
    const countRes = await query(
      `SELECT COUNT(*)::int AS n FROM erp_invoice_acceptances ${whereSql}`,
      params,
    );
    total = countRes.rows[0]?.n || 0;
    const listParams = [...params, limit, offset];
    const res = await query(
      `SELECT * FROM erp_invoice_acceptances ${whereSql}
       ORDER BY accepted_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams,
    );
    rows = res.rows;
  } catch (err) {
    if (String(err.message).includes('erp_invoice_acceptances')) {
      return { items: [], total: 0, limit, offset, tab: 'accepted' };
    }
    throw err;
  }

  const items = rows.map((r) => ({
    id: r.erp_id,
    regNo: r.reg_no,
    regDate: r.reg_date,
    status: r.status,
    statusRu: r.status,
    payType: r.pay_type,
    payTypeRu: r.pay_type,
    branch: r.branch,
    branchCode: '',
    currency: r.currency,
    amount: Number(r.amount) || 0,
    sumInWords: '',
    explanation: '',
    title: r.title,
    initiator: r.initiator,
    initiatorDept: '',
    recipient: '',
    paymentBasis: [],
    cashierReceived: {
      received: true,
      receivedAt: r.accepted_at,
      receivedBy: r.cashier_name,
    },
    bankReceived: { received: false, receivedAt: null, receivedBy: '' },
    needsCashier: false,
    awaitAccept: false,
    localAccepted: true,
    localAcceptance: {
      cashierId: r.cashier_id,
      cashierName: r.cashier_name,
      note: r.note,
      erpPushed: r.erp_pushed,
      erpPushError: r.erp_push_error,
      acceptedAt: r.accepted_at,
    },
  }));

  return { items, total, limit, offset, tab: 'accepted' };
}

export async function getCashierInvoice(id) {
  const item = await fetchErpInvoiceById(id);
  const locals = await localAcceptanceMap([item.id]);
  return attachLocal(item, locals.get(item.id));
}

export async function acceptCashierInvoice(id, { cashier, note = '' } = {}) {
  if (!cashier?.id) {
    const err = new Error('Кассир не указан');
    err.status = 400;
    throw err;
  }

  const item = await fetchErpInvoiceById(id);
  const locals = await localAcceptanceMap([item.id]);
  if (locals.has(item.id) || item.cashierReceived?.received) {
    const err = new Error('Счёт уже принят кассой');
    err.status = 409;
    throw err;
  }
  if (!['Approved', 'Archived', 'Sent to Feeds'].includes(item.status)) {
    const err = new Error('Можно принять только согласованный счёт (Approved)');
    err.status = 400;
    throw err;
  }
  if (item.payType !== 'Cash' && item.payType !== 'Both') {
    const err = new Error('Этот счёт без кассы (банковский). Принятие кассиром не требуется.');
    err.status = 400;
    throw err;
  }

  const acceptedAt = new Date().toISOString();
  const push = await pushCashierReceivedToErp(item.id, {
    receivedBy: cashier.name || 'Касса',
    receivedAt: acceptedAt,
  });

  if (!push.ok && requireErpPush()) {
    const err = new Error(
      push.reason ||
        'Не удалось отметить «Получено кассой» в ERP. Символ кассы не появится.',
    );
    err.status = push.status === 401 ? 502 : 502;
    err.erpPush = push;
    throw err;
  }

  const snapshot = { ...item };

  await query(
    `INSERT INTO erp_invoice_acceptances (
       erp_id, reg_no, reg_date, title, initiator, branch, pay_type,
       amount, currency, status, snapshot, cashier_id, cashier_name, note,
       erp_pushed, erp_push_error, accepted_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17::timestamptz
     )
     ON CONFLICT (erp_id) DO UPDATE SET
       cashier_id = EXCLUDED.cashier_id,
       cashier_name = EXCLUDED.cashier_name,
       note = EXCLUDED.note,
       erp_pushed = EXCLUDED.erp_pushed,
       erp_push_error = EXCLUDED.erp_push_error,
       accepted_at = EXCLUDED.accepted_at`,
    [
      item.id,
      item.regNo,
      item.regDate,
      item.title,
      item.initiator,
      item.branch,
      item.payType,
      item.amount,
      item.currency,
      item.status,
      JSON.stringify(snapshot),
      cashier.id,
      cashier.name || '',
      String(note || '').trim(),
      Boolean(push.ok),
      push.ok ? '' : push.reason || '',
      acceptedAt,
    ],
  );

  return {
    ok: true,
    invoice: attachLocal(
      {
        ...item,
        cashierReceived: {
          received: true,
          receivedAt: acceptedAt,
          receivedBy: cashier.name || 'Касса',
        },
        needsCashier: false,
      },
      {
        cashier_id: cashier.id,
        cashier_name: cashier.name || '',
        note: String(note || '').trim(),
        erp_pushed: Boolean(push.ok),
        erp_push_error: push.ok ? '' : push.reason || '',
        accepted_at: acceptedAt,
      },
    ),
    erpPush: push,
  };
}

/** Retry ERP kassa mark for a locally accepted invoice. */
export async function retryErpPush(id, { cashier } = {}) {
  const locals = await localAcceptanceMap([id]);
  const local = locals.get(id);
  if (!local) {
    const err = new Error('Сначала примите счёт в кассе');
    err.status = 404;
    throw err;
  }

  const receivedBy = cashier?.name || local.cashier_name || 'Касса';
  const receivedAt = local.accepted_at
    ? new Date(local.accepted_at).toISOString()
    : new Date().toISOString();

  const push = await pushCashierReceivedToErp(id, { receivedBy, receivedAt });
  await query(
    `UPDATE erp_invoice_acceptances
     SET erp_pushed = $2, erp_push_error = $3
     WHERE erp_id = $1`,
    [id, Boolean(push.ok), push.ok ? '' : push.reason || ''],
  );

  if (!push.ok) {
    const err = new Error(push.reason || 'Не удалось отметить кассу в ERP');
    err.status = 502;
    err.erpPush = push;
    throw err;
  }

  return { ok: true, erpPush: push };
}
