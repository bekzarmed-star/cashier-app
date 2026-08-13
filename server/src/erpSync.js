import { query } from './db.js';
import { collectErpRows, rowsToSheet, ERP_HEADERS } from './erpApi.js';

export const ERP_EXCEL_FILE_ID = 'xf-erp-soglasovano';
export const ERP_EXCEL_FILE_NAME = 'ERP Согласовано';

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
    return { ...base, headers: r.headers, data: r.sheet_data };
  }
  return base;
}

/**
 * Pull ERP approved invoices (+ agreed business trips) into a dedicated Excel file.
 */
export async function syncErpToExcel(actor = { id: 'admin1', name: 'ERP Sync' }) {
  const collected = await collectErpRows();
  const sheet = rowsToSheet(collected.rows);

  // excel_files.created_by / updated_by reference cashiers(id)
  let actorId = actor?.id || 'admin1';
  let actorName = actor?.name || 'ERP Sync';
  const { rows: actorRows } = await query(`SELECT id, name FROM cashiers WHERE id = $1`, [actorId]);
  if (!actorRows[0]) {
    const { rows: fallback } = await query(
      `SELECT id, name FROM cashiers WHERE username = 'admin' OR role = 'admin' ORDER BY created_at LIMIT 1`,
    );
    if (fallback[0]) {
      actorId = fallback[0].id;
      actorName = fallback[0].name || actorName;
    } else {
      actorId = null;
      actorName = null;
    }
  }

  const { rows: existing } = await query(`SELECT id FROM excel_files WHERE id = $1`, [
    ERP_EXCEL_FILE_ID,
  ]);

  let file;
  if (!existing[0]) {
    const { rows } = await query(
      `INSERT INTO excel_files (
         id, name, headers, sheet_data, created_by, created_by_name, updated_by, updated_by_name
       ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$5,$6)
       RETURNING *`,
      [
        ERP_EXCEL_FILE_ID,
        ERP_EXCEL_FILE_NAME,
        JSON.stringify(sheet.headers),
        JSON.stringify(sheet.data),
        actorId,
        actorName,
      ],
    );
    file = mapExcelFile(rows[0], true);
  } else {
    const { rows } = await query(
      `UPDATE excel_files SET
         name = $2,
         headers = $3::jsonb,
         sheet_data = $4::jsonb,
         updated_by = $5,
         updated_by_name = $6,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        ERP_EXCEL_FILE_ID,
        ERP_EXCEL_FILE_NAME,
        JSON.stringify(sheet.headers),
        JSON.stringify(sheet.data),
        actorId,
        actorName,
      ],
    );
    file = mapExcelFile(rows[0], true);
  }

  return {
    ok: true,
    file,
    count: collected.rows.length,
    invoiceCount: collected.invoices.rows.length,
    tripCount: collected.trips.rows.length,
    invoices: {
      skipped: collected.invoices.skipped,
      reason: collected.invoices.reason,
      totalFetched: collected.invoices.totalFetched,
    },
    trips: {
      skipped: collected.trips.skipped,
      reason: collected.trips.reason,
      totalFetched: collected.trips.totalFetched,
    },
    headers: ERP_HEADERS,
    config: collected.config,
  };
}

export function startErpAutoSync() {
  const ms = Number(process.env.ERP_SYNC_INTERVAL_MS || 0);
  if (!ms || ms < 30_000) {
    console.log('ERP auto-sync disabled (set ERP_SYNC_INTERVAL_MS >= 30000 to enable)');
    return;
  }

  const run = () => {
    syncErpToExcel({ id: 'admin1', name: 'ERP Auto Sync' })
      .then((r) => {
        console.log(
          `ERP sync: ${r.count} rows (invoices=${r.invoiceCount}, trips=${r.tripCount}) → ${r.file.name}`,
        );
      })
      .catch((err) => console.warn('ERP sync failed:', err.message));
  };

  // first run shortly after boot
  setTimeout(run, 8_000);
  setInterval(run, ms);
  console.log(`ERP auto-sync every ${Math.round(ms / 1000)}s`);
}
