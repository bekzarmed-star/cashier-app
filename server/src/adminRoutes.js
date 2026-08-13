import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from './db.js';
import {
  adminKeyUpload,
  ensureAdminSeed,
  fingerprintKey,
  isStrongPassword,
  mapCashier,
  newSessionToken,
  requireAdmin,
  ADMIN_DEFAULT_PASSWORD,
} from './adminAuth.js';
import { ensureCurrentMonthExcelFile } from './monthlyExcel.js';

const router = Router();

const BASE_HEADERS = [
  'Дата',
  'Инициатор',
  'Наименование',
  'Сумма',
  'Статус',
  'Филиал',
  'Форма оплаты',
  'Код',
  'Примечание',
];

function emptySheet() {
  const rows = [];
  rows.push(['', '', '', '=SUM(D2:D41)', '', '', '', 'TOTAL', '']);
  for (let i = 0; i < 40; i++) {
    rows.push(['', '', '', null, '', '', '', '', '']);
  }
  return rows;
}

/** POST /api/admin/login — username + strong password + E-imzo key file */
router.post('/login', adminKeyUpload, async (req, res) => {
  try {
    await ensureAdminSeed();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const keyFile = req.file;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (!keyFile?.buffer?.length) {
      return res.status(400).json({
        error: 'E-imzo key file is required (.pfx, .p12, .key, .pem)',
      });
    }

    const { rows } = await query(
      `SELECT * FROM cashiers WHERE username = $1 AND active = TRUE`,
      [username],
    );
    const user = rows[0];
    if (!user || user.role !== 'admin') {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const { rows: cfgRows } = await query(
      `SELECT key_fingerprint FROM admin_config WHERE id = 1`,
    );
    const expected = cfgRows[0]?.key_fingerprint;
    const actual = fingerprintKey(keyFile.buffer);
    if (!expected || actual !== expected) {
      return res.status(401).json({
        error: 'E-imzo key is invalid or does not match the registered admin key',
      });
    }

    const token = newSessionToken();
    const expires = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await query(
      `INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES ($1, $2, $3)`,
      [token, user.id, expires.toISOString()],
    );

    res.json({
      token,
      expiresAt: expires.toISOString(),
      admin: mapCashier(user),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', requireAdmin, async (req, res) => {
  try {
    await query(`DELETE FROM admin_sessions WHERE token = $1`, [req.adminToken]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAdmin, (req, res) => {
  res.json(req.admin);
});

/** Users */
router.get('/users', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, username, name, role, counter_id, active, created_at
       FROM cashiers ORDER BY created_at ASC`,
    );
    res.json(rows.map(mapCashier));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { username, name, password, role = 'cashier', counterId = 'C-01' } = req.body ?? {};
    const u = String(username || '').trim().toLowerCase();
    const n = String(name || '').trim();
    const p = String(password || '');
    const r = String(role || 'cashier');

    if (!u || !n || !p) {
      return res.status(400).json({ error: 'username, name and password are required' });
    }
    if (!isStrongPassword(p)) {
      return res.status(400).json({
        error:
          'Password must be at least 12 characters and include upper, lower, number, and special character',
      });
    }
    if (!['cashier', 'supervisor', 'admin'].includes(r)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const hash = await bcrypt.hash(p, 12);
    const id = `u-${Date.now()}`;
    const { rows } = await query(
      `INSERT INTO cashiers (id, username, password_hash, name, role, counter_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, username, name, role, counter_id, active, created_at`,
      [id, u, hash, n, r, String(counterId || 'C-01')],
    );
    res.status(201).json(mapCashier(rows[0]));
  } catch (err) {
    if (String(err.message).includes('unique') || err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id/password', requireAdmin, async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error:
          'Password must be at least 12 characters and include upper, lower, number, and special character',
      });
    }
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `UPDATE cashiers SET password_hash = $1 WHERE id = $2
       RETURNING id, username, name, role, counter_id, active, created_at`,
      [hash, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(mapCashier(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { name, role, counterId, active } = req.body ?? {};
    const { rows } = await query(
      `UPDATE cashiers SET
         name = COALESCE($2, name),
         role = COALESCE($3, role),
         counter_id = COALESCE($4, counter_id),
         active = COALESCE($5, active)
       WHERE id = $1
       RETURNING id, username, name, role, counter_id, active, created_at`,
      [
        req.params.id,
        name != null ? String(name).trim() : null,
        role != null ? String(role) : null,
        counterId != null ? String(counterId) : null,
        typeof active === 'boolean' ? active : null,
      ],
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(mapCashier(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/password', requireAdmin, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error:
          'New password must be at least 12 characters and include upper, lower, number, and special character',
      });
    }
    const { rows } = await query(`SELECT * FROM cashiers WHERE id = $1`, [req.admin.id]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await query(`UPDATE cashiers SET password_hash = $1 WHERE id = $2`, [hash, req.admin.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Excel files (admin) */
function mapExcel(r, includeData = false) {
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
    return { ...base, headers: r.headers, data: r.sheet_data };
  }
  return base;
}

router.get('/excel/files', requireAdmin, async (_req, res) => {
  try {
    await ensureCurrentMonthExcelFile();
    const { rows } = await query(
      `SELECT id, name, created_by, created_by_name, updated_by, updated_by_name, created_at, updated_at
       FROM excel_files ORDER BY updated_at DESC`,
    );
    res.json({ count: rows.length, files: rows.map((r) => mapExcel(r)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/excel/files/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM excel_files WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'File not found' });
    res.json(mapExcel(rows[0], true));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/excel/files', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim() || `Admin sheet ${new Date().toLocaleString()}`;
    const headers = req.body?.headers?.length ? req.body.headers : BASE_HEADERS;
    const data = req.body?.data?.length ? req.body.data : emptySheet();
    const id = `xf-${Date.now()}`;
    const { rows } = await query(
      `INSERT INTO excel_files (
         id, name, headers, sheet_data, created_by, created_by_name, updated_by, updated_by_name
       ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$5,$6)
       RETURNING *`,
      [
        id,
        name,
        JSON.stringify(headers),
        JSON.stringify(data),
        req.admin.id,
        req.admin.name,
      ],
    );
    res.status(201).json(mapExcel(rows[0], true));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/excel/files/:id', requireAdmin, async (req, res) => {
  try {
    const { name, headers, data } = req.body ?? {};
    const { rows } = await query(
      `UPDATE excel_files SET
         name = COALESCE($2, name),
         headers = COALESCE($3::jsonb, headers),
         sheet_data = COALESCE($4::jsonb, sheet_data),
         updated_by = $5,
         updated_by_name = $6,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        name != null ? String(name).trim() : null,
        headers != null ? JSON.stringify(headers) : null,
        data != null ? JSON.stringify(data) : null,
        req.admin.id,
        req.admin.name,
      ],
    );
    if (!rows[0]) return res.status(404).json({ error: 'File not found' });
    res.json(mapExcel(rows[0], true));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/excel/files/:id', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await query(`DELETE FROM excel_files WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'File not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/key-info', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT key_file_name, updated_at FROM admin_config WHERE id = 1`,
    );
    res.json({
      keyFileName: rows[0]?.key_file_name || 'admin.eimzo.key',
      updatedAt: rows[0]?.updated_at,
      hint: 'Upload the registered E-imzo key file at admin login',
      defaultPasswordHint:
        process.env.NODE_ENV === 'production'
          ? undefined
          : `Default seed password: ${ADMIN_DEFAULT_PASSWORD}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Local employees (added by admin — used in Excel autocomplete + Workers page) */
function mapAdminEmployee(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    branchCode: row.branch_code || '',
    branchName: row.branch_name || '',
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get('/employees', requireAdmin, async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || '') === '1';
    const q = String(req.query.q || '').trim().toLowerCase();
    const params = [];
    let sql = `SELECT * FROM employees WHERE 1=1`;
    if (!includeInactive) sql += ` AND active = TRUE`;
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (
        LOWER(full_name) LIKE $${params.length} OR
        LOWER(branch_code) LIKE $${params.length} OR
        LOWER(branch_name) LIKE $${params.length}
      )`;
    }
    sql += ` ORDER BY full_name ASC`;
    const { rows } = await query(sql, params);
    res.json(rows.map(mapAdminEmployee));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/employees', requireAdmin, async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    const branchCode = String(req.body?.branchCode || '').trim();
    const branchName = String(req.body?.branchName || '').trim();
    if (!fullName) {
      return res.status(400).json({ error: 'ФИО обязательно' });
    }
    const id = `emp-${Date.now()}`;
    const { rows } = await query(
      `INSERT INTO employees (id, full_name, branch_code, branch_name)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [id, fullName, branchCode, branchName],
    );
    res.status(201).json(mapAdminEmployee(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/employees/:id', requireAdmin, async (req, res) => {
  try {
    const { fullName, branchCode, branchName, active } = req.body ?? {};
    const { rows } = await query(
      `UPDATE employees SET
         full_name = COALESCE($2, full_name),
         branch_code = COALESCE($3, branch_code),
         branch_name = COALESCE($4, branch_name),
         active = COALESCE($5, active),
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        fullName != null ? String(fullName).trim() : null,
        branchCode != null ? String(branchCode).trim() : null,
        branchName != null ? String(branchName).trim() : null,
        typeof active === 'boolean' ? active : null,
      ],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Сотрудник не найден' });
    res.json(mapAdminEmployee(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/employees/:id', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await query(`DELETE FROM employees WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Сотрудник не найден' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
