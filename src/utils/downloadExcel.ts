import * as XLSX from 'xlsx';

export function downloadSheetAsExcel(
  fileName: string,
  headers: string[],
  data: (string | number | null)[][],
) {
  const rows = [headers, ...data.map((row) => headers.map((_, i) => row[i] ?? ''))];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Cashier');

  const safe = (fileName || 'cashier-sheet')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim() || 'cashier-sheet';

  XLSX.writeFile(workbook, `${safe}.xlsx`);
}
