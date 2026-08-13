/**
 * REST client for the external HR / integration system.
 * Credentials come from server .env only (never VITE_*).
 */

import { query } from './db.js';

function config() {
  const baseUrl = (process.env.EXTERNAL_API_URL || 'http://192.168.1.250:8000').replace(
    /\/$/,
    '',
  );
  const apiKey = process.env.EXTERNAL_API_KEY || '';
  return { baseUrl, apiKey };
}

function ensureConfigured() {
  const { apiKey } = config();
  if (!apiKey) {
    const err = new Error('EXTERNAL_API_KEY is not configured');
    err.status = 500;
    throw err;
  }
}

async function externalGet(path, params = {}) {
  ensureConfigured();
  const { baseUrl, apiKey } = config();
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-API-Key': apiKey,
    },
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const err = new Error(`External API returned non-JSON (${res.status})`);
    err.status = res.status;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(data?.detail || data?.error || `External API ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return data;
}

function mapEmployee(item) {
  return {
    id: item.id,
    fullName: item.full_name ?? '',
    branchCode: item.branch_code ?? '',
    branchName: item.branch_short_name ?? '',
    source: 'external',
  };
}

function mapLocalEmployee(row) {
  return {
    id: row.id,
    fullName: row.full_name ?? '',
    branchCode: row.branch_code ?? '',
    branchName: row.branch_name ?? '',
    source: 'local',
    active: row.active !== false,
  };
}

export async function listLocalEmployees({ q = '', includeInactive = false } = {}) {
  const params = [];
  let sql = `SELECT id, full_name, branch_code, branch_name, active, created_at, updated_at
             FROM employees WHERE 1=1`;
  if (!includeInactive) {
    sql += ` AND active = TRUE`;
  }
  const needle = String(q || '').trim().toLowerCase();
  if (needle) {
    params.push(`%${needle}%`);
    sql += ` AND (
      LOWER(full_name) LIKE $1 OR
      LOWER(branch_code) LIKE $1 OR
      LOWER(branch_name) LIKE $1 OR
      LOWER(id) LIKE $1
    )`;
  }
  sql += ` ORDER BY full_name ASC`;
  try {
    const { rows } = await query(sql, params);
    return rows.map(mapLocalEmployee);
  } catch (err) {
    // Table may not exist yet before seed
    if (String(err.message).includes('employees')) return [];
    throw err;
  }
}

/**
 * Fetch employees from external integration API.
 * When `q` is set and the upstream has no search, we pull a larger page and filter.
 */
export async function fetchEmployees({ limit = 100, offset = 0, q = '' } = {}) {
  const queryText = String(q || '').trim().toLowerCase();
  const local = await listLocalEmployees({ q: queryText, includeInactive: false });

  let externalItems = [];
  let externalTotal = 0;
  try {
    if (!queryText) {
      const data = await externalGet('/api/v1/integration/employees', {
        limit,
        offset,
      });
      externalItems = Array.isArray(data.items) ? data.items.map(mapEmployee) : [];
      externalTotal = Number(data.total ?? externalItems.length);
    } else {
      const data = await externalGet('/api/v1/integration/employees', {
        limit: 500,
        offset: 0,
      });
      const all = Array.isArray(data.items) ? data.items.map(mapEmployee) : [];
      const filtered = all.filter(
        (e) =>
          e.fullName.toLowerCase().includes(queryText) ||
          e.branchCode.toLowerCase().includes(queryText) ||
          e.branchName.toLowerCase().includes(queryText) ||
          String(e.id).includes(queryText),
      );
      externalTotal = filtered.length;
      externalItems = filtered;
    }
  } catch {
    // External API optional — still return local employees
    externalItems = [];
    externalTotal = 0;
  }

  // Local first, then external (skip external dups by name+branch)
  const localKeys = new Set(
    local.map((e) => `${e.fullName.toLowerCase()}|${e.branchCode.toLowerCase()}`),
  );
  const mergedExternal = externalItems.filter(
    (e) => !localKeys.has(`${e.fullName.toLowerCase()}|${e.branchCode.toLowerCase()}`),
  );

  const all = [...local, ...mergedExternal];
  const start = Number(offset) || 0;
  const size = Number(limit) || 100;
  return {
    total: local.length + (queryText ? mergedExternal.length : Math.max(externalTotal, mergedExternal.length)),
    limit: size,
    offset: start,
    items: all.slice(start, start + size),
    localCount: local.length,
  };
}

export async function employeesHealth() {
  const { baseUrl } = config();
  let localCount = 0;
  try {
    const local = await listLocalEmployees({ includeInactive: true });
    localCount = local.length;
  } catch {
    localCount = 0;
  }
  try {
    const data = await externalGet('/api/v1/integration/employees', {
      limit: 1,
      offset: 0,
    });
    return {
      ok: true,
      total: Number(data.total ?? 0) + localCount,
      localCount,
      baseUrl,
    };
  } catch (err) {
    return {
      ok: localCount > 0,
      total: localCount,
      localCount,
      error: err.message,
      baseUrl,
    };
  }
}
