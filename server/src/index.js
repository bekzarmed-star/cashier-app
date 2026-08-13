import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { pool, query } from './db.js';
import { fetchEmployees, employeesHealth } from './externalApi.js';
import adminRoutes from './adminRoutes.js';
import { ensureAdminSeed } from './adminAuth.js';
import { erpHealth } from './erpApi.js';
import { syncErpToExcel, startErpAutoSync } from './erpSync.js';
import {
  acceptCashierInvoice,
  getCashierInvoice,
  listCashierInvoiceQueue,
  retryErpPush,
} from './erpInvoices.js';
import { ensureCurrentMonthExcelFile, startMonthlyExcelEnsure } from './monthlyExcel.js';

const app = express();
const PORT = Number(process.env.API_PORT || 4002);

app.use(cors({ origin: true }));
app.use(express.json({ limit: '15mb' }));
app.use('/api/admin', adminRoutes);

function mapPatient(r) {
  return {
    id: r.id,
    mrn: r.mrn,
    name: r.name,
    phone: r.phone ?? undefined,
    age: r.age ?? undefined,
    gender: r.gender ?? undefined,
    department: r.department ?? undefined,
  };
}

function mapItem(r) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category,
    qty: Number(r.qty),
    unitPrice: Number(r.unit_price),
    discount: Number(r.discount),
  };
}

function billTotal(items) {
  return items.reduce((s, i) => s + i.qty * i.unitPrice - i.discount, 0);
}

async function loadBill(billId) {
  const { rows } = await query(
    `SELECT b.*, p.mrn, p.name AS patient_name, p.phone, p.age, p.gender, p.department
     FROM bills b JOIN patients p ON p.id = b.patient_id
     WHERE b.id = $1`,
    [billId],
  );
  if (!rows[0]) return null;
  const b = rows[0];
  const { rows: items } = await query(
    `SELECT * FROM bill_items WHERE bill_id = $1 ORDER BY id`,
    [billId],
  );
  return {
    id: b.id,
    invoiceNo: b.invoice_no,
    status: b.status,
    createdAt: b.created_at,
    notes: b.notes ?? undefined,
    paidAmount: Number(b.paid_amount),
    patient: mapPatient({
      id: b.patient_id,
      mrn: b.mrn,
      name: b.patient_name,
      phone: b.phone,
      age: b.age,
      gender: b.gender,
      department: b.department,
    }),
    items: items.map(mapItem),
  };
}

function mapTx(r) {
  return {
    id: r.id,
    receiptNo: r.receipt_no,
    billId: r.bill_id,
    invoiceNo: r.invoice_no,
    patient: r.patient_snap,
    items: r.items_snap,
    payments: r.payments,
    accountCode: r.account_code ?? undefined,
    subtotal: Number(r.subtotal),
    discount: Number(r.discount),
    total: Number(r.total),
    amountPaid: Number(r.amount_paid),
    change: Number(r.change_amt),
    cashierId: r.cashier_id,
    cashierName: r.cashier_name,
    counterId: r.counter_id,
    createdAt: r.created_at,
    status: r.status,
  };
}

app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await query('SELECT NOW() AS now, current_database() AS db');
    res.json({ ok: true, database: rows[0].db, time: rows[0].now });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/cashier/login', async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    const { rows } = await query(
      `SELECT * FROM cashiers WHERE username = $1 AND active = TRUE`,
      [username],
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(String(password ?? ''), user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    res.json({
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      counterId: user.counter_id,
      phone: user.phone || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Self-register a new cashier (name must match a worker from HR list). */
app.post('/api/cashier/register', async (req, res) => {
  try {
    const body = req.body ?? {};
    const username = String(body.username || '')
      .trim()
      .toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const counterId = String(body.counterId || 'C-01').trim() || 'C-01';

    if (!username || !password || !name) {
      return res.status(400).json({ error: 'Укажите логин, пароль и ФИО из списка сотрудников' });
    }
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return res.status(400).json({
        error: 'Логин: 3–32 символа (латиница, цифры, . _ -)',
      });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов' });
    }

    // Name must come from workers list
    let matched = null;
    try {
      const page = await fetchEmployees({ limit: 500, offset: 0, q: name });
      matched = (page.items || []).find(
        (e) => String(e.fullName || '').trim().toLowerCase() === name.toLowerCase(),
      );
      if (!matched && page.items?.length) {
        matched = page.items.find((e) =>
          String(e.fullName || '').trim().toLowerCase().includes(name.toLowerCase()),
        );
        if (matched && String(matched.fullName).trim().toLowerCase() !== name.toLowerCase()) {
          matched = null;
        }
      }
    } catch (err) {
      return res.status(502).json({
        error: `Список сотрудников недоступен: ${err.message || 'ошибка'}`,
      });
    }
    if (!matched) {
      return res.status(400).json({
        error: 'ФИО должно быть выбрано из списка сотрудников (Сотрудники)',
      });
    }

    const displayName = String(matched.fullName).trim();
    const { rows: existing } = await query(
      `SELECT id FROM cashiers WHERE LOWER(username) = LOWER($1)`,
      [username],
    );
    if (existing[0]) {
      return res.status(409).json({ error: 'Такой логин уже занят' });
    }

    const hash = await bcrypt.hash(password, 10);
    const id = `u-${Date.now()}`;
    const { rows } = await query(
      `INSERT INTO cashiers (id, username, password_hash, name, role, counter_id, phone)
       VALUES ($1,$2,$3,$4,'cashier',$5,$6)
       RETURNING id, username, name, role, counter_id, phone`,
      [id, username, hash, displayName, counterId, phone],
    );
    const u = rows[0];
    res.status(201).json({
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
      counterId: u.counter_id,
      phone: u.phone || '',
    });
  } catch (err) {
    if (String(err.message).includes('unique') || err.code === '23505') {
      return res.status(409).json({ error: 'Такой логин уже занят' });
    }
    res.status(500).json({ error: err.message });
  }
});

/** Update cashier display name / phone */
app.put('/api/cashier/profile', async (req, res) => {
  try {
    const { cashierId, name, phone } = req.body ?? {};
    const id = String(cashierId || '').trim();
    if (!id) return res.status(400).json({ error: 'cashierId is required' });

    const nextName = String(name || '').trim();
    const nextPhone = String(phone || '').trim();
    if (!nextName) return res.status(400).json({ error: 'Имя обязательно' });

    const { rows } = await query(
      `UPDATE cashiers SET name = $2, phone = $3
       WHERE id = $1 AND active = TRUE
       RETURNING id, username, name, role, counter_id, phone`,
      [id, nextName, nextPhone],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Кассир не найден' });
    const u = rows[0];
    res.json({
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
      counterId: u.counter_id,
      phone: u.phone || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Change cashier password (requires current password) */
app.put('/api/cashier/password', async (req, res) => {
  try {
    const { cashierId, currentPassword, newPassword } = req.body ?? {};
    const id = String(cashierId || '').trim();
    const current = String(currentPassword || '');
    const next = String(newPassword || '');
    if (!id) return res.status(400).json({ error: 'cashierId is required' });
    if (!current || !next) {
      return res.status(400).json({ error: 'Введите текущий и новый пароль' });
    }
    if (next.length < 4) {
      return res.status(400).json({ error: 'Новый пароль должен быть не короче 4 символов' });
    }

    const { rows } = await query(`SELECT * FROM cashiers WHERE id = $1 AND active = TRUE`, [id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Кассир не найден' });
    if (!(await bcrypt.compare(current, user.password_hash))) {
      return res.status(401).json({ error: 'Текущий пароль неверный' });
    }

    const hash = await bcrypt.hash(next, 10);
    await query(`UPDATE cashiers SET password_hash = $1 WHERE id = $2`, [hash, id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cashier/patients', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    let rows;
    if (!q) {
      ({ rows } = await query(`SELECT * FROM patients ORDER BY name LIMIT 50`));
    } else {
      ({ rows } = await query(
        `SELECT * FROM patients
         WHERE name ILIKE $1 OR mrn ILIKE $1 OR COALESCE(phone,'') ILIKE $1
         ORDER BY name LIMIT 50`,
        [`%${q}%`],
      ));
    }
    res.json(rows.map(mapPatient));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cashier/bills/pending', async (req, res) => {
  try {
    const patientId = req.query.patientId;
    const params = [];
    let sql = `SELECT id FROM bills WHERE status IN ('pending','partial')`;
    if (patientId) {
      params.push(patientId);
      sql += ` AND patient_id = $1`;
    }
    sql += ` ORDER BY created_at DESC`;
    const { rows } = await query(sql, params);
    const bills = [];
    for (const r of rows) {
      const bill = await loadBill(r.id);
      if (bill) bills.push(bill);
    }
    res.json(bills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cashier/bills/:id', async (req, res) => {
  try {
    const bill = await loadBill(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    res.json(bill);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cashier/payments', async (req, res) => {
  const client = await pool.connect();
  try {
    const { billId, payments, amountPaid, change, cashier, accountCode } = req.body ?? {};
    if (!billId || !cashier?.id || !Array.isArray(payments)) {
      return res.status(400).json({ error: 'Invalid payment payload' });
    }

    await client.query('BEGIN');
    const bill = await loadBill(billId);
    if (!bill) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bill not found' });
    }

    const due = Math.max(0, billTotal(bill.items) - bill.paidAmount);
    const paidNow = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

    let newPaid = bill.paidAmount;
    let status = bill.status;
    if (paidNow < due - 0.5) {
      newPaid += paidNow;
      status = 'partial';
    } else {
      newPaid = billTotal(bill.items);
      status = 'paid';
    }

    await client.query(
      `UPDATE bills SET paid_amount = $1, status = $2 WHERE id = $3`,
      [newPaid, status, billId],
    );

    if (accountCode) {
      const { rows: codeRows } = await client.query(
        `SELECT code FROM account_codes WHERE code = $1`,
        [accountCode],
      );
      if (!codeRows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Unknown account code: ${accountCode}` });
      }
    }

    const receiptNo = `RCP-2026-${Math.floor(3100 + Math.random() * 9000)}`;
    const txId = `t-${Date.now()}`;
    const subtotal = bill.items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    const discount = bill.items.reduce((s, i) => s + i.discount, 0);
    const total = billTotal(bill.items);

    const { rows } = await client.query(
      `INSERT INTO transactions (
         id, receipt_no, bill_id, invoice_no, patient_id, patient_snap, items_snap,
         payments, account_code, subtotal, discount, total, amount_paid, change_amt,
         cashier_id, cashier_name, counter_id, status
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'completed'
       ) RETURNING *`,
      [
        txId,
        receiptNo,
        bill.id,
        bill.invoiceNo,
        bill.patient.id,
        JSON.stringify(bill.patient),
        JSON.stringify(bill.items),
        JSON.stringify(payments),
        accountCode || null,
        subtotal,
        discount,
        total,
        Number(amountPaid),
        Number(change || 0),
        cashier.id,
        cashier.name,
        cashier.counterId,
      ],
    );

    await client.query('COMMIT');
    res.status(201).json(mapTx(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/cashier/transactions', async (req, res) => {
  try {
    const q = String(req.query.query || '').trim();
    let rows;
    if (!q) {
      ({ rows } = await query(
        `SELECT * FROM transactions ORDER BY created_at DESC LIMIT 200`,
      ));
    } else {
      ({ rows } = await query(
        `SELECT * FROM transactions
         WHERE receipt_no ILIKE $1
            OR invoice_no ILIKE $1
            OR patient_snap->>'name' ILIKE $1
            OR patient_snap->>'mrn' ILIKE $1
            OR COALESCE(account_code,'') ILIKE $1
         ORDER BY created_at DESC LIMIT 200`,
        [`%${q}%`],
      ));
    }
    res.json(rows.map(mapTx));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cashier/stats', async (_req, res) => {
  try {
    const { rows: txRows } = await query(
      `SELECT * FROM transactions
       WHERE status = 'completed' AND created_at::date = CURRENT_DATE`,
    );
    const sumBy = (method) =>
      txRows.reduce((s, t) => {
        const payments = t.payments || [];
        return (
          s +
          payments
            .filter((p) => p.method === method)
            .reduce((a, p) => a + Number(p.amount || 0), 0)
        );
      }, 0);

    const { rows: pending } = await query(
      `SELECT COUNT(*)::int AS n FROM bills WHERE status IN ('pending','partial')`,
    );

    res.json({
      todayCollections: txRows.reduce((s, t) => s + Number(t.total), 0),
      todayTransactions: txRows.length,
      cashTotal: sumBy('cash'),
      cardTotal: sumBy('card'),
      transferTotal: sumBy('transfer'),
      insuranceTotal: sumBy('insurance'),
      pendingBills: pending[0].n,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cashier/codes', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const group = req.query.group ? String(req.query.group) : '';
    const includeArchived = String(req.query.includeArchived || '') === 'true';

    const clauses = [];
    const params = [];
    if (!includeArchived) clauses.push(`archived = FALSE`);
    if (group) {
      params.push(group);
      clauses.push(`grp = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      clauses.push(
        `(code ILIKE $${i} OR english ILIKE $${i} OR russian ILIKE $${i} OR uzbek ILIKE $${i} OR note ILIKE $${i})`,
      );
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT code, english, russian, uzbek, note, archived, grp AS "group"
       FROM account_codes ${where}
       ORDER BY code`,
      params,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cashier/codes/:code', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT code, english, russian, uzbek, note, archived, grp AS "group"
       FROM account_codes WHERE UPPER(code) = UPPER($1)`,
      [req.params.code],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Code not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/cashier/codes — add a new account code */
app.post('/api/cashier/codes', async (req, res) => {
  try {
    const body = req.body ?? {};
    const code = String(body.code || '')
      .trim()
      .toUpperCase();
    const english = String(body.english || '').trim();
    const russian = String(body.russian || '').trim();
    const uzbek = String(body.uzbek || '').trim();
    const note = String(body.note || '').trim();
    const group =
      body.group === 'Прочий приход' || body.group === 'Расход'
        ? body.group
        : 'Расход';
    const archived = Boolean(body.archived);

    if (!code) {
      return res.status(400).json({ error: 'Укажите код счёта' });
    }
    if (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/i.test(code)) {
      return res.status(400).json({
        error: 'Код: буквы/цифры, до 20 символов (напр. A1, C8, P12)',
      });
    }
    if (!russian && !uzbek && !english) {
      return res.status(400).json({ error: 'Укажите название (русский, узбекский или английский)' });
    }

    const { rows: existing } = await query(
      `SELECT code FROM account_codes WHERE UPPER(code) = UPPER($1)`,
      [code],
    );
    if (existing[0]) {
      return res.status(409).json({ error: `Код «${code}» уже существует` });
    }

    const { rows } = await query(
      `INSERT INTO account_codes (code, english, russian, uzbek, note, archived, grp)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING code, english, russian, uzbek, note, archived, grp AS "group"`,
      [code, english, russian, uzbek, note, archived, group],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cashier/drawer', async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM cash_drawers ORDER BY opened_at DESC LIMIT 1`,
    );
    if (!rows[0]) return res.status(404).json({ error: 'No drawer session' });
    const d = rows[0];
    res.json({
      id: d.id,
      counterId: d.counter_id,
      cashierId: d.cashier_id,
      cashierName: d.cashier_name,
      openedAt: d.opened_at,
      closedAt: d.closed_at ?? undefined,
      openingFloat: Number(d.opening_float),
      expectedCash: d.expected_cash != null ? Number(d.expected_cash) : undefined,
      countedCash: d.counted_cash != null ? Number(d.counted_cash) : undefined,
      variance: d.variance != null ? Number(d.variance) : undefined,
      status: d.status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cashier/drawer/open', async (req, res) => {
  try {
    const { openingFloat, cashier } = req.body ?? {};
    if (!cashier?.id) return res.status(400).json({ error: 'Cashier required' });

    await query(
      `UPDATE cash_drawers SET status = 'closed', closed_at = COALESCE(closed_at, NOW())
       WHERE status = 'open'`,
    );

    const id = `d-${Date.now()}`;
    const { rows } = await query(
      `INSERT INTO cash_drawers (id, counter_id, cashier_id, cashier_name, opening_float, status)
       VALUES ($1,$2,$3,$4,$5,'open') RETURNING *`,
      [id, cashier.counterId, cashier.id, cashier.name, Number(openingFloat) || 0],
    );
    const d = rows[0];
    res.status(201).json({
      id: d.id,
      counterId: d.counter_id,
      cashierId: d.cashier_id,
      cashierName: d.cashier_name,
      openedAt: d.opened_at,
      openingFloat: Number(d.opening_float),
      status: d.status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cashier/drawer/close', async (req, res) => {
  try {
    const countedCash = Number(req.body?.countedCash || 0);
    const { rows: openRows } = await query(
      `SELECT * FROM cash_drawers WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1`,
    );
    const d = openRows[0];
    if (!d) return res.status(400).json({ error: 'No open drawer' });

    const { rows: txs } = await query(
      `SELECT * FROM transactions
       WHERE status = 'completed' AND created_at >= $1`,
      [d.opened_at],
    );
    const cashCollected = txs.reduce((s, t) => {
      const cashIn = (t.payments || [])
        .filter((p) => p.method === 'cash')
        .reduce((a, p) => a + Number(p.amount || 0), 0);
      return s + cashIn - Number(t.change_amt || 0);
    }, 0);
    const expected = Number(d.opening_float) + cashCollected;
    const variance = countedCash - expected;

    const { rows } = await query(
      `UPDATE cash_drawers
       SET closed_at = NOW(), expected_cash = $1, counted_cash = $2, variance = $3, status = 'closed'
       WHERE id = $4 RETURNING *`,
      [expected, countedCash, variance, d.id],
    );
    const c = rows[0];
    res.json({
      id: c.id,
      counterId: c.counter_id,
      cashierId: c.cashier_id,
      cashierName: c.cashier_name,
      openedAt: c.opened_at,
      closedAt: c.closed_at,
      openingFloat: Number(c.opening_float),
      expectedCash: Number(c.expected_cash),
      countedCash: Number(c.counted_cash),
      variance: Number(c.variance),
      status: c.status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function mapExcelFile(r, includeData = false) {
  const base = {
    id: r.id,
    name: r.name,
    createdBy: r.created_by ?? undefined,
    createdByName: r.created_by_name ?? undefined,
    updatedBy: r.updated_by ?? undefined,
    updatedByName: r.updated_by_name ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (includeData) {
    return {
      ...base,
      headers: r.headers,
      data: r.sheet_data,
    };
  }
  return base;
}

app.get('/api/cashier/excel/files', async (_req, res) => {
  try {
    await ensureCurrentMonthExcelFile();
    const { rows } = await query(
      `SELECT id, name, created_by, created_by_name, updated_by, updated_by_name, created_at, updated_at
       FROM excel_files ORDER BY updated_at DESC`,
    );
    const { rows: countRows } = await query(`SELECT COUNT(*)::int AS n FROM excel_files`);
    res.json({ count: countRows[0].n, files: rows.map((r) => mapExcelFile(r)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cashier/excel/files/:id', async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM excel_files WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'File not found' });
    res.json(mapExcelFile(rows[0], true));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cashier/excel/files', async (req, res) => {
  try {
    const { name, headers, data, cashier } = req.body ?? {};
    const fileName = String(name || '').trim() || `Sheet ${new Date().toLocaleString()}`;
    const id = `xf-${Date.now()}`;
    const { rows } = await query(
      `INSERT INTO excel_files (
         id, name, headers, sheet_data, created_by, created_by_name, updated_by, updated_by_name
       ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$5,$6)
       RETURNING *`,
      [
        id,
        fileName,
        JSON.stringify(headers || []),
        JSON.stringify(data || []),
        cashier?.id || null,
        cashier?.name || null,
      ],
    );
    res.status(201).json(mapExcelFile(rows[0], true));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/cashier/excel/files/:id', async (req, res) => {
  try {
    const { name, headers, data, cashier } = req.body ?? {};
    const { rows } = await query(
      `UPDATE excel_files SET
         name = COALESCE($2, name),
         headers = COALESCE($3::jsonb, headers),
         sheet_data = COALESCE($4::jsonb, sheet_data),
         updated_by = COALESCE($5, updated_by),
         updated_by_name = COALESCE($6, updated_by_name),
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        name != null ? String(name).trim() : null,
        headers != null ? JSON.stringify(headers) : null,
        data != null ? JSON.stringify(data) : null,
        cashier?.id || null,
        cashier?.name || null,
      ],
    );
    if (!rows[0]) return res.status(404).json({ error: 'File not found' });
    res.json(mapExcelFile(rows[0], true));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cashier/excel/files/:id', async (_req, res) => {
  res.status(403).json({
    error: 'Удаление Excel-файлов доступно только администратору',
  });
});

app.get('/api/cashier/employees/health', async (_req, res) => {
  const status = await employeesHealth();
  res.status(status.ok ? 200 : 502).json(status);
});

app.get('/api/cashier/employees', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const q = String(req.query.q || '');
    const data = await fetchEmployees({ limit, offset, q });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/cashier/erp/health', async (_req, res) => {
  const status = await erpHealth();
  res.status(status.ok ? 200 : 502).json(status);
});

app.post('/api/cashier/erp/sync', async (req, res) => {
  try {
    const cashier = req.body?.cashier;
    const result = await syncErpToExcel(
      cashier?.id
        ? { id: cashier.id, name: cashier.name || 'Cashier' }
        : { id: 'admin1', name: 'ERP Sync' },
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** ERP invoices — cashier accept queue («Получено кассой») */
app.get('/api/cashier/erp/invoices', async (req, res) => {
  try {
    const data = await listCashierInvoiceQueue({
      tab: String(req.query.tab || 'awaiting'),
      q: String(req.query.q || ''),
      branch: String(req.query.branch || ''),
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/cashier/erp/invoices/:id', async (req, res) => {
  try {
    const invoice = await getCashierInvoice(req.params.id);
    res.json(invoice);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/cashier/erp/invoices/:id/accept', async (req, res) => {
  try {
    const result = await acceptCashierInvoice(req.params.id, {
      cashier: req.body?.cashier,
      note: req.body?.note,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      erpPush: err.erpPush || undefined,
    });
  }
});

app.post('/api/cashier/erp/invoices/:id/push-erp', async (req, res) => {
  try {
    const result = await retryErpPush(req.params.id, {
      cashier: req.body?.cashier,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      erpPush: err.erpPush || undefined,
    });
  }
});

ensureAdminSeed()
  .then((info) => {
    console.log(`Admin E-imzo key ready: ${info.keyPath}`);
  })
  .catch((err) => {
    console.warn('Admin seed warning:', err.message);
  });

startErpAutoSync();
startMonthlyExcelEnsure();

app.listen(PORT, () => {
  console.log(`Cashier API listening on http://127.0.0.1:${PORT}`);
  console.log(`PostgreSQL → ${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'cashier'}`);
  console.log(`External API → ${process.env.EXTERNAL_API_URL || 'http://192.168.1.250:8000'}`);
  console.log(`ERP BMS → ${process.env.ERP_BASE_URL || 'http://159.223.235.20:4001'}`);
});
