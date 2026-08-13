export interface BranchOption {
  code: string;
  label: string;
}

/** ERP invoiceBranch codes → Russian labels */
export const BRANCHES: BranchOption[] = [
  { code: 'samarkand', label: 'Самарканд' },
  { code: 'bukhara', label: 'Бухара' },
  { code: 'karshi', label: 'Карши' },
  { code: 'shahrisabz', label: 'Шахрисабз' },
];

export function branchLabel(code: string | null | undefined): string {
  const key = String(code || '').trim().toLowerCase();
  if (!key) return '';
  return BRANCHES.find((b) => b.code === key)?.label || String(code);
}

export function isValidBranchCode(code: string | null | undefined): boolean {
  const key = String(code || '').trim().toLowerCase();
  return BRANCHES.some((b) => b.code === key);
}

/** Match employee/invoice branch fields against selected code */
export function matchesBranch(
  selectedCode: string,
  branchCode?: string | null,
  branchName?: string | null,
): boolean {
  const selected = String(selectedCode || '').trim().toLowerCase();
  if (!selected) return true;
  const code = String(branchCode || '').trim().toLowerCase();
  const name = String(branchName || '').trim().toLowerCase();
  const label = branchLabel(selected).toLowerCase();
  if (code === selected) return true;
  if (name === label || name.includes(label) || label.includes(name)) return true;
  if (name.includes(selected) || code.includes(selected)) return true;
  return false;
}
