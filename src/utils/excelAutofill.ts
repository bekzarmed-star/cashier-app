/** Pending Excel row fill after «Дал деньги» on ERP invoice */

export const EXCEL_AUTOFILL_KEY = 'zph_excel_autofill';

export interface ExcelAutofillRow {
  date: string;
  initiator: string;
  title: string;
  amount: number;
  status: string;
  branch: string;
  payForm: string;
  code: string;
  note: string;
  regNo: string;
  erpId: string;
}

export function saveExcelAutofill(row: ExcelAutofillRow) {
  sessionStorage.setItem(EXCEL_AUTOFILL_KEY, JSON.stringify(row));
}

/** Read without removing — safe with React Strict Mode double-effects. */
export function peekExcelAutofill(): ExcelAutofillRow | null {
  try {
    const raw = sessionStorage.getItem(EXCEL_AUTOFILL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ExcelAutofillRow;
  } catch {
    sessionStorage.removeItem(EXCEL_AUTOFILL_KEY);
    return null;
  }
}

export function clearExcelAutofill() {
  sessionStorage.removeItem(EXCEL_AUTOFILL_KEY);
}

/** @deprecated Prefer peek + clear after success */
export function takeExcelAutofill(): ExcelAutofillRow | null {
  const row = peekExcelAutofill();
  clearExcelAutofill();
  return row;
}

export function buildRowFromAutofill(
  headers: string[],
  fill: ExcelAutofillRow,
): (string | number | null)[] {
  const map: Record<string, string | number | null> = {
    Дата: fill.date,
    Инициатор: fill.initiator,
    Сотрудник: fill.initiator,
    Наименование: fill.title,
    Сумма: fill.amount,
    Статус: fill.status || 'Согласовано',
    Филиал: fill.branch,
    'Форма оплаты': fill.payForm,
    Оплата: fill.payForm,
    Код: fill.code || '',
    Code: fill.code || '',
    Примечание: fill.note,
    Ссылка: fill.regNo ? `ERP ${fill.regNo}` : '',
  };
  return headers.map((h) => (map[h] !== undefined ? map[h] : h === 'Сумма' ? null : ''));
}
