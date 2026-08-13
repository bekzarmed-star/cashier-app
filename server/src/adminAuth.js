import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { query } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const KEYS_DIR = path.join(__dirname, '../keys');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

export const adminKeyUpload = upload.single('key');

export const ADMIN_DEFAULT_PASSWORD = 'Zarmed@Admin#2026!Kp';

export function isStrongPassword(password) {
  const p = String(password || '');
  return (
    p.length >= 12 &&
    /[a-z]/.test(p) &&
    /[A-Z]/.test(p) &&
    /\d/.test(p) &&
    /[^A-Za-z0-9]/.test(p)
  );
}

export function fingerprintKey(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function ensureAdminSeed() {
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });

  const keyPath = path.join(KEYS_DIR, 'admin.eimzo.key');
  let keyBuf;
  if (fs.existsSync(keyPath)) {
    keyBuf = fs.readFileSync(keyPath);
  } else {
    keyBuf = crypto.randomBytes(64);
    fs.writeFileSync(keyPath, keyBuf);
  }
  const fp = fingerprintKey(keyBuf);

  const hash = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 12);
  const { rows: existingAdmin } = await query(
    `SELECT id FROM cashiers WHERE username = 'admin'`,
  );
  const keepPassword = process.env.ADMIN_KEEP_PASSWORD === '1';
  if (!existingAdmin[0]) {
    await query(
      `INSERT INTO cashiers (id, username, password_hash, name, role, counter_id)
       VALUES ('admin1', 'admin', $1, 'System Administrator', 'admin', 'A-01')`,
      [hash],
    );
  } else if (keepPassword) {
    await query(
      `UPDATE cashiers SET role = 'admin', name = 'System Administrator' WHERE username = 'admin'`,
    );
  } else {
    await query(
      `UPDATE cashiers SET role = 'admin', name = 'System Administrator', password_hash = $1
       WHERE username = 'admin'`,
      [hash],
    );
  }

  const { rows } = await query(`SELECT key_fingerprint FROM admin_config WHERE id = 1`);
  if (!rows[0]) {
    await query(
      `INSERT INTO admin_config (id, key_fingerprint, key_file_name)
       VALUES (1, $1, 'admin.eimzo.key')`,
      [fp],
    );
  } else if (rows[0].key_fingerprint !== fp) {
    // Keep DB fingerprint in sync with key file on disk for this deployment
    await query(
      `UPDATE admin_config SET key_fingerprint = $1, key_file_name = 'admin.eimzo.key', updated_at = NOW()
       WHERE id = 1`,
      [fp],
    );
  }

  return { keyPath, fingerprint: fp };
}

export async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      return res.status(401).json({ error: 'Admin authorization required' });
    }
    const { rows } = await query(
      `SELECT s.token, s.expires_at, c.id, c.username, c.name, c.role, c.counter_id, c.active
       FROM admin_sessions s
       JOIN cashiers c ON c.id = s.admin_id
       WHERE s.token = $1`,
      [token],
    );
    const session = rows[0];
    if (!session || !session.active || session.role !== 'admin') {
      return res.status(401).json({ error: 'Invalid admin session' });
    }
    if (new Date(session.expires_at) < new Date()) {
      await query(`DELETE FROM admin_sessions WHERE token = $1`, [token]);
      return res.status(401).json({ error: 'Admin session expired' });
    }
    req.admin = {
      id: session.id,
      username: session.username,
      name: session.name,
      role: session.role,
      counterId: session.counter_id,
    };
    req.adminToken = token;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export function mapCashier(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    counterId: row.counter_id,
    active: row.active,
    createdAt: row.created_at,
  };
}
