/** Russian month names (1-based index unused; 0 = January) */
export const MONTH_NAMES_RU = [
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
] as const;

/** Monthly workbook name, e.g. "Август 2026" */
export function monthlyCashierFileName(date = new Date()): string {
  const month = MONTH_NAMES_RU[date.getMonth()];
  const yyyy = String(date.getFullYear());
  return `${month} ${yyyy}`;
}

/** Match current month name or legacy "Касса MM.yyyy" / "Касса dd.MM.yyyy" */
export function isCashierSheetForMonth(fileName: string, date = new Date()): boolean {
  const name = String(fileName || '').trim();
  if (name === monthlyCashierFileName(date)) return true;

  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  const monthRu = MONTH_NAMES_RU[date.getMonth()];

  // Legacy monthly: Касса 08.2026
  if (new RegExp(`^Касса\\s+${mm}\\.${yyyy}$`, 'i').test(name)) return true;
  // Legacy daily: Касса 25.08.2026
  if (new RegExp(`^Касса\\s+\\d{2}\\.${mm}\\.${yyyy}$`, 'i').test(name)) return true;
  // Month name without year edge cases
  if (new RegExp(`^${monthRu}\\s+${yyyy}$`, 'i').test(name)) return true;

  return false;
}
