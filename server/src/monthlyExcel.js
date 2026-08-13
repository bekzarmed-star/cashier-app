import { query } from './db.js';

const MONTH_NAMES_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

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
  // TOTAL first
  rows.push(['', '', '', '=SUM(D2:D41)', '', '', '', 'TOTAL', '']);
  for (let i = 0; i < 40; i++) {
    rows.push(['', '', '', null, '', '', '', '', '']);
  }
  return rows;
}

/** e.g. "Август 2026" */
export function monthlyCashierFileName(date = new Date()) {
  const month = MONTH_NAMES_RU[date.getMonth()];
  const yyyy = String(date.getFullYear());
  return `${month} ${yyyy}`;
}

function legacyMonthlyName(date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `Касса ${mm}.${yyyy}`;
}

/**
 * Ensures the current calendar month's cashier Excel file exists.
 * Prefer month-name title; reuse/rename legacy "Касса MM.yyyy" if present.
 */
export async function ensureCurrentMonthExcelFile() {
  const name = monthlyCashierFileName();
  const legacy = legacyMonthlyName();

  const { rows: existing } = await query(
    `SELECT id, name FROM excel_files WHERE name = $1 OR name = $2 LIMIT 1`,
    [name, legacy],
  );

  if (existing[0]) {
    if (existing[0].name !== name) {
      await query(`UPDATE excel_files SET name = $2, updated_at = NOW() WHERE id = $1`, [
        existing[0].id,
        name,
      ]);
      console.log(`[monthly-excel] Renamed «${existing[0].name}» → «${name}»`);
      return { created: false, renamed: true, name, id: existing[0].id };
    }
    return { created: false, name, id: existing[0].id };
  }

  const id = `xf-month-${Date.now()}`;
  const { rows } = await query(
    `INSERT INTO excel_files (
       id, name, headers, sheet_data, created_by, created_by_name, updated_by, updated_by_name
     ) VALUES ($1,$2,$3::jsonb,$4::jsonb,NULL,$5,NULL,$5)
     RETURNING id, name`,
    [
      id,
      name,
      JSON.stringify(BASE_HEADERS),
      JSON.stringify(emptySheet()),
      'Автосоздание (месяц)',
    ],
  );

  console.log(`[monthly-excel] Created monthly file: ${rows[0].name} (${rows[0].id})`);
  return { created: true, name: rows[0].name, id: rows[0].id };
}

/** Check every hour so a new month file appears right after month end. */
export function startMonthlyExcelEnsure() {
  const run = () => {
    ensureCurrentMonthExcelFile().catch((err) => {
      console.warn('[monthly-excel] ensure failed:', err.message);
    });
  };
  run();
  setInterval(run, 60 * 60 * 1000);
}
