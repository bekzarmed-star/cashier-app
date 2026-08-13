import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { HotTable } from '@handsontable/react-wrapper';
import { registerAllModules } from 'handsontable/registry';
import { HyperFormula } from 'hyperformula';
import type { HotTableRef } from '@handsontable/react-wrapper';
import type Handsontable from 'handsontable';
import {
  ArrowLeft,
  ClipboardPlus,
  Columns3,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sheet,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  ACCOUNT_CODES,
  getAccountByCode,
  getActiveCodes,
} from '../data/accountCodes';
import { displayName } from '../types/accountCode';
import { useCashierActor } from '../context/useCashierActor';
import {
  excelFilesApi,
  type ExcelFile,
  type ExcelFileMeta,
} from '../api/excelFilesApi';
import { downloadSheetAsExcel } from '../utils/downloadExcel';
import { employeesApi, type Employee } from '../api/employeesApi';
import { erpApi } from '../api/erpApi';
import {
  buildRowFromAutofill,
  clearExcelAutofill,
  EXCEL_AUTOFILL_KEY,
  peekExcelAutofill,
  type ExcelAutofillRow,
} from '../utils/excelAutofill';
import {
  isCashierSheetForMonth,
  monthlyCashierFileName,
} from '../utils/monthlyCashierSheet';
import 'handsontable/styles/handsontable.min.css';
import 'handsontable/styles/ht-theme-main.min.css';

registerAllModules();

const ERP_EXCEL_FILE_ID = 'xf-erp-soglasovano';

const COL = {
  DATE: 0,
  INITIATOR: 1,
  TITLE: 2,
  AMOUNT: 3,
  STATUS: 4,
  BRANCH: 5,
  PAY_FORM: 6,
  CODE: 7,
  NOTE: 8,
} as const;

/** Cashier sheet columns (aligned with ERP invoice fields) */
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

const BRANCH_OPTIONS = ['Самарканд', 'Бухара', 'Карши', 'Шахрисабз'];
const STATUS_OPTIONS = ['Согласовано', 'Черновик', 'На согласовании', 'Отклонён', 'Архив'];
const PAY_FORM_OPTIONS = ['Наличные', 'Банк', 'Касса / Банк', 'карта', 'перевод', 'страховка'];

/** Old English / legacy headers → Russian (existing files) */
const HEADER_RENAME: Record<string, string> = {
  Date: 'Дата',
  DATE: 'Дата',
  Code: 'Код',
  CODE: 'Код',
  Worker: 'Инициатор',
  WORKER: 'Инициатор',
  Сотрудник: 'Инициатор',
  Initiator: 'Инициатор',
  INITIATOR: 'Инициатор',
  Title: 'Наименование',
  TITLE: 'Наименование',
  Name: 'Наименование',
  Amount: 'Сумма',
  AMOUNT: 'Сумма',
  Status: 'Статус',
  STATUS: 'Статус',
  Branch: 'Филиал',
  BRANCH: 'Филиал',
  Payment: 'Форма оплаты',
  PAYMENT: 'Форма оплаты',
  Оплата: 'Форма оплаты',
  'Pay form': 'Форма оплаты',
  Reference: 'Ссылка',
  REFERENCE: 'Ссылка',
  Note: 'Примечание',
  NOTE: 'Примечание',
};

const REMOVED_HEADERS = new Set([
  'English',
  'Russian',
  'Uzbek',
  'Английский',
  'Русский',
  'Узбекский',
  'Group',
  'GROUP',
  'Группа',
]);

/** Cached workers from REST API for Excel autocomplete */
let workersCache: Employee[] = [];

function setWorkersCache(list: Employee[]) {
  workersCache = list;
}

type ColDef = Handsontable.ColumnSettings;
type SheetData = (string | number | null)[][];

interface SheetPayload {
  headers: string[];
  data: SheetData;
}

const DATA_ROWS = 40;

function colDefForHeader(name: string): ColDef {
  switch (name) {
    case 'Дата':
    case 'Date':
      return { type: 'date', dateFormat: 'YYYY-MM-DD', correctFormat: true };
    case 'Инициатор':
    case 'Сотрудник':
    case 'Worker':
      return {
        type: 'autocomplete',
        source: workerSource,
        strict: false,
        filter: true,
        visibleRows: 12,
        allowInvalid: true,
      };
    case 'Наименование':
      return {
        type: 'autocomplete',
        source: titleSource,
        strict: false,
        filter: true,
        visibleRows: 12,
        allowInvalid: true,
      };
    case 'Код':
    case 'Code':
      return {
        type: 'autocomplete',
        source: codeSource,
        strict: false,
        filter: true,
        visibleRows: 10,
        allowInvalid: true,
      };
    case 'Сумма':
    case 'Amount':
      return { type: 'numeric', numericFormat: { pattern: '0,0' } };
    case 'Статус':
    case 'Status':
      return { type: 'dropdown', source: STATUS_OPTIONS };
    case 'Филиал':
    case 'Branch':
      return { type: 'dropdown', source: BRANCH_OPTIONS };
    case 'Форма оплаты':
    case 'Оплата':
    case 'Payment':
      return { type: 'dropdown', source: PAY_FORM_OPTIONS };
    default:
      return { type: 'text' };
  }
}

const BASE_COLUMNS: ColDef[] = BASE_HEADERS.map(colDefForHeader);

function emptyRow(colCount: number): (string | number | null)[] {
  return Array.from({ length: colCount }, (_, i) => (i === COL.AMOUNT ? null : ''));
}

function isTotalMarkerRow(
  row: (string | number | null)[] | undefined,
  amountIdx: number,
  codeIdx: number,
): boolean {
  if (!row) return false;
  const code = String(row[codeIdx] ?? '').toUpperCase();
  const amount = String(row[amountIdx] ?? '');
  return code === 'TOTAL' || amount.startsWith('=SUM');
}

function sumFormulaForSheet(amountCol: number, totalRows: number): string {
  const letter = colLetter(amountCol);
  // TOTAL is row 1 in spreadsheet terms; data starts at row 2
  const lastDataRow = Math.max(2, totalRows);
  return `=SUM(${letter}2:${letter}${lastDataRow})`;
}

/** Keep TOTAL on row 0 and refresh its SUM formula. */
function ensureTotalAtTop(headers: string[], data: SheetData): SheetData {
  const amountIdx = headers.indexOf('Сумма') >= 0 ? headers.indexOf('Сумма') : headers.indexOf('Amount');
  const codeIdx = headers.indexOf('Код') >= 0 ? headers.indexOf('Код') : headers.indexOf('Code');
  const amt = amountIdx >= 0 ? amountIdx : COL.AMOUNT;
  const code = codeIdx >= 0 ? codeIdx : COL.CODE;

  const rows = data.map((r) => [...r]);
  let totalIdx = rows.findIndex((r) => isTotalMarkerRow(r, amt, code));

  let totalRow: (string | number | null)[];
  if (totalIdx >= 0) {
    totalRow = rows.splice(totalIdx, 1)[0];
  } else {
    totalRow = emptyRow(headers.length || BASE_HEADERS.length);
  }

  while (totalRow.length < headers.length) {
    totalRow.push(totalRow.length === amt ? null : '');
  }
  if (code >= 0) totalRow[code] = 'TOTAL';
  if (amt >= 0) {
    totalRow[amt] = sumFormulaForSheet(amt, rows.length + 1);
  }

  return [totalRow, ...rows];
}

function buildInitialData(colCount = BASE_HEADERS.length): SheetData {
  const today = format(new Date(), 'yyyy-MM-dd');
  const amountCol = Math.min(COL.AMOUNT, colCount - 1);
  const codeCol = Math.min(COL.CODE, colCount - 1);
  const statusCol = Math.min(COL.STATUS, colCount - 1);

  const total = emptyRow(colCount);
  if (codeCol >= 0) total[codeCol] = 'TOTAL';
  total[amountCol] = sumFormulaForSheet(amountCol, DATA_ROWS + 1);

  const rows: SheetData = [total];
  for (let i = 0; i < DATA_ROWS; i++) {
    const row = emptyRow(colCount);
    if (i === 0) {
      row[COL.DATE] = today;
      if (statusCol >= 0) row[statusCol] = 'Согласовано';
    }
    rows.push(row);
  }
  return rows;
}

function columnsFromHeaders(headers: string[]): ColDef[] {
  return headers.map(colDefForHeader);
}

function sanitizeSheet(sheet: SheetPayload): SheetPayload {
  // Rename English → Russian, then drop removed columns (Group, language cols, …)
  const mapped = sheet.headers.map((h) => HEADER_RENAME[h] || HEADER_RENAME[h.trim()] || h);
  const keepIdx = mapped
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => !REMOVED_HEADERS.has(h));

  // Deduplicate by header name (prefer first)
  const seen = new Set<string>();
  const uniqueKeep = keepIdx.filter(({ h }) => {
    if (seen.has(h)) return false;
    seen.add(h);
    return true;
  });

  let headers = uniqueKeep.map(({ h }) => h);
  let data: SheetData = sheet.data.map((row) =>
    uniqueKeep.map(({ i }) => {
      const v = row[i];
      return v === undefined ? '' : v;
    }),
  );

  // Synced ERP feed sheets keep their own column layout
  const isErpSheet = headers.includes('Рег. №') || headers.includes('ERP ID');
  if (isErpSheet) {
    if (data.length < 2) {
      data = [
        ...data,
        ...Array.from({ length: Math.max(0, 20 - data.length) }, () =>
          Array.from({ length: headers.length }, () => ''),
        ),
      ];
    }
    return { headers, data };
  }

  // Always restore the standard cashier columns (older/test files may miss them)
  for (const base of BASE_HEADERS) {
    if (!headers.includes(base)) {
      headers.push(base);
      data = data.map((row) => {
        const next: (string | number | null)[] = [...row, base === 'Сумма' ? null : ''];
        return next;
      });
    }
  }

  // Base columns first (fixed order), then any custom columns
  const custom = headers.filter((h) => !BASE_HEADERS.includes(h));
  const ordered = [...BASE_HEADERS, ...custom];
  const indexOf = (name: string) => headers.indexOf(name);
  data = data.map((row) =>
    ordered.map((name) => {
      const v = row[indexOf(name)];
      if (v === undefined) return name === 'Сумма' ? null : '';
      return v;
    }),
  );

  // Ensure enough working rows + a TOTAL row at the top
  if (data.length < 2) {
    data = buildInitialData(ordered.length);
  } else {
    data = ensureTotalAtTop(ordered, data);
  }

  return { headers: ordered, data };
}

function codeSource(query: string, process: (items: string[]) => void) {
  const q = (query || '').trim().toLowerCase();
  const active = getActiveCodes();
  const ranked = !q
    ? active
    : [
        ...active.filter((c) => c.code.toLowerCase() === q),
        ...active.filter(
          (c) => c.code.toLowerCase().startsWith(q) && c.code.toLowerCase() !== q,
        ),
        ...active.filter((c) => {
          const code = c.code.toLowerCase();
          if (code === q || code.startsWith(q)) return false;
          return (
            code.includes(q) ||
            c.english.toLowerCase().includes(q) ||
            c.russian.toLowerCase().includes(q) ||
            c.uzbek.toLowerCase().includes(q)
          );
        }),
      ];

  process(
    ranked.slice(0, 40).map((c) => {
      const name = displayName(c, 'en') || displayName(c, 'ru') || displayName(c, 'uz');
      return `${c.code} — ${name}`;
    }),
  );
}

function workerSource(query: string, process: (items: string[]) => void) {
  const q = (query || '').trim().toLowerCase();
  const ranked = !q
    ? workersCache
    : [
        ...workersCache.filter((e) => e.fullName.toLowerCase().startsWith(q)),
        ...workersCache.filter((e) => {
          const name = e.fullName.toLowerCase();
          if (name.startsWith(q)) return false;
          return (
            name.includes(q) ||
            e.branchCode.toLowerCase().includes(q) ||
            e.branchName.toLowerCase().includes(q)
          );
        }),
      ];

  process(
    ranked.slice(0, 40).map((e) =>
      e.branchCode ? `${e.fullName} — ${e.branchCode}` : e.fullName,
    ),
  );
}

/** Наименование — filterable list from account codes (RU/UZ), not a full dump */
function titleSource(query: string, process: (items: string[]) => void) {
  const q = (query || '').trim().toLowerCase();
  const labels = getActiveCodes()
    .map((c) => {
      const ru = (c.russian || '').trim();
      const uz = (c.uzbek || '').trim();
      const en = (c.english || '').trim();
      return ru || uz || en;
    })
    .filter(Boolean);

  const unique = [...new Set(labels)];
  const ranked = !q
    ? unique
    : [
        ...unique.filter((t) => t.toLowerCase().startsWith(q)),
        ...unique.filter((t) => {
          const low = t.toLowerCase();
          return !low.startsWith(q) && low.includes(q);
        }),
      ];

  process(ranked.slice(0, 40));
}

/** Extract bare worker name from "Name — SAM" or plain name. */
function parseWorkerCell(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.includes('—') ? raw.split('—')[0]!.trim() : raw;
}

function normalizeWorkerCell(hot: Handsontable.Core, row: number, value: unknown) {
  const name = parseWorkerCell(value);
  if (!name) return;
  const match = workersCache.find(
    (e) => e.fullName.toLowerCase() === name.toLowerCase(),
  );
  const finalName = match?.fullName ?? name;
  const workerCol = findColAny(hot, 'Инициатор', 'Сотрудник', 'Worker');
  if (workerCol >= 0 && String(hot.getDataAtCell(row, workerCol)) !== finalName) {
    hot.setDataAtCell(row, workerCol, finalName, 'worker-autofill');
  }
  // Auto-fill branch from employee if Филиал is empty
  if (match) {
    const branchCol = findColAny(hot, 'Филиал', 'Branch');
    if (branchCol >= 0 && !String(hot.getDataAtCell(row, branchCol) || '').trim()) {
      const code = String(match.branchCode || '').toLowerCase();
      const name = String(match.branchName || '').toLowerCase();
      const fromCode: Record<string, string> = {
        sam: 'Самарканд',
        samarkand: 'Самарканд',
        buk: 'Бухара',
        bukhara: 'Бухара',
        kar: 'Карши',
        karshi: 'Карши',
        sha: 'Шахрисабз',
        shahrisabz: 'Шахрисабз',
      };
      const branchLabel =
        BRANCH_OPTIONS.find((b) => b.toLowerCase() === name) ||
        fromCode[code] ||
        fromCode[code.slice(0, 3)] ||
        match.branchName ||
        '';
      if (branchLabel) {
        hot.setDataAtCell(row, branchCol, branchLabel, 'worker-autofill');
      }
    }
  }
}

function parseCodeCell(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const beforeDash = raw.includes('—') ? raw.split('—')[0]!.trim() : raw;
  const token = beforeDash.split(/\s+/)[0] ?? '';
  return token.toUpperCase();
}

function findCol(hot: Handsontable.Core, name: string): number {
  for (let c = 0; c < hot.countCols(); c++) {
    if (String(hot.getColHeader(c)) === name) return c;
  }
  return -1;
}

function findColAny(hot: Handsontable.Core, ...names: string[]) {
  for (const name of names) {
    const i = findCol(hot, name);
    if (i >= 0) return i;
  }
  return -1;
}

function colLetter(index: number): string {
  let n = index;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function readVisualSheet(hot: Handsontable.Core): SheetPayload {
  const nextHeaders: string[] = [];
  for (let c = 0; c < hot.countCols(); c++) {
    nextHeaders.push(String(hot.getColHeader(c)));
  }
  const data: SheetData = [];
  for (let r = 0; r < hot.countRows(); r++) {
    const row: (string | number | null)[] = [];
    for (let c = 0; c < hot.countCols(); c++) {
      row.push(hot.getDataAtCell(r, c) as string | number | null);
    }
    data.push(row);
  }
  return { headers: nextHeaders, data };
}

function fillFromCode(hot: Handsontable.Core, row: number, codeValue: unknown) {
  const code = parseCodeCell(codeValue);
  if (!code) return;
  const account = getAccountByCode(code);
  if (!account) return;

  const set = (headers: string[], value: string) => {
    const col = findColAny(hot, ...headers);
    if (col >= 0) hot.setDataAtCell(row, col, value, 'code-autofill');
  };

  set(['Код', 'Code'], account.code);

  const titleCol = findColAny(hot, 'Наименование');
  if (titleCol >= 0 && !String(hot.getDataAtCell(row, titleCol) || '').trim()) {
    const title =
      (account.russian || '').trim() ||
      (account.uzbek || '').trim() ||
      (account.english || '').trim();
    if (title) hot.setDataAtCell(row, titleCol, title, 'code-autofill');
  }

  const noteCol = findColAny(hot, 'Примечание', 'Note');
  if (noteCol >= 0 && !hot.getDataAtCell(row, noteCol)) {
    // Prefer Excel «коды» local text (Uzbek / Russian / Izoh), not English
    const label =
      (account.uzbek || '').trim() ||
      (account.russian || '').trim() ||
      (account.note || '').trim();
    if (label) hot.setDataAtCell(row, noteCol, label, 'code-autofill');
  }
}

export function ExcelPage() {
  const user = useCashierActor();
  const location = useLocation();
  const navigate = useNavigate();
  const hotRef = useRef<HotTableRef>(null);

  const [view, setView] = useState<'list' | 'editor'>('list');
  const [files, setFiles] = useState<ExcelFileMeta[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [activeFile, setActiveFile] = useState<ExcelFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [newFileName, setNewFileName] = useState('');
  const [showNewBox, setShowNewBox] = useState(false);

  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const [columnName, setColumnName] = useState('');
  const [busy, setBusy] = useState(false);
  const [erpSyncing, setErpSyncing] = useState(false);
  const [sheetSearch, setSheetSearch] = useState('');
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [searchHitCount, setSearchHitCount] = useState(0);
  const [rowFormOpen, setRowFormOpen] = useState(false);
  const [rowForm, setRowForm] = useState<Record<string, string>>({});
  const [rowFormBusy, setRowFormBusy] = useState(false);
  const [codeSuggestOpen, setCodeSuggestOpen] = useState(false);

  const [headers, setHeaders] = useState<string[]>([...BASE_HEADERS]);
  const [columns, setColumns] = useState<ColDef[]>([...BASE_COLUMNS]);
  const [tableKey, setTableKey] = useState(0);
  const [sheetData, setSheetData] = useState<SheetData>(() => buildInitialData());

  const activeFileRef = useRef<ExcelFile | null>(null);
  const fileNameRef = useRef('');
  const userRef = useRef(user);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);
  useEffect(() => {
    fileNameRef.current = fileName;
  }, [fileName]);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const page = await employeesApi.list({ limit: 500, offset: 0 });
        if (!alive) return;
        setWorkersCache(page.items);
        setHint((h) => h || `Загружено ${page.items.length} сотрудников — выбирайте в «Инициатор»`);
      } catch {
        if (alive) setHint('Список сотрудников недоступен — вводите имена вручную');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const hyperformula = useMemo(
    () =>
      HyperFormula.buildEmpty({
        licenseKey: 'internal-use-in-handsontable',
      }),
    [],
  );

  const refreshFiles = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const res = await excelFilesApi.list();
      setFiles(res.files);
      setFileCount(res.count);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Не удалось загрузить файлы');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  const openEditor = useCallback((file: ExcelFile) => {
    const clean = sanitizeSheet({
      headers: file.headers?.length ? file.headers : [...BASE_HEADERS],
      data: file.data?.length ? file.data : buildInitialData(),
    });
    setActiveFile(file);
    setFileName(file.name);
    setHeaders(clean.headers);
    setColumns(columnsFromHeaders(clean.headers));
    setSheetData(clean.data);
    setTableKey((k) => k + 1);
    setSavedAt(null);
    setHint('');
    setSheetSearch('');
    setOnlyMatches(false);
    setSearchHitCount(0);
    setRowFormOpen(false);
    setRowForm({});
    setView('editor');
  }, []);

  /** Insert ERP «Дал деньги» row into sheet data (after TOTAL on top). */
  const applyAutofillToFile = useCallback(
    async (file: ExcelFile, fill: ExcelAutofillRow) => {
      const clean = sanitizeSheet({
        headers: file.headers?.length ? file.headers : [...BASE_HEADERS],
        data: file.data?.length ? file.data : buildInitialData(),
      });
      // Always keep cashier base columns including Код
      let headers = clean.headers;
      for (const h of BASE_HEADERS) {
        if (!headers.includes(h)) headers = [...headers, h];
      }
      let data = clean.data.map((r) => {
        const row = [...r];
        while (row.length < headers.length) row.push(row.length === COL.AMOUNT ? null : '');
        return row;
      });
      data = ensureTotalAtTop(headers, data);
      const newRow = buildRowFromAutofill(headers, fill);

      const amountIdx = headers.indexOf('Сумма');
      const initIdx =
        headers.indexOf('Инициатор') >= 0
          ? headers.indexOf('Инициатор')
          : headers.indexOf('Сотрудник');
      const titleIdx = headers.indexOf('Наименование');
      const codeIdx = headers.indexOf('Код') >= 0 ? headers.indexOf('Код') : headers.indexOf('Code');

      const isBlankWorkingRow = (row: (string | number | null)[]) => {
        const codeCell = String(row[codeIdx] ?? '').toUpperCase();
        if (codeCell === 'TOTAL') return false;
        if (String(row[amountIdx] ?? '').startsWith('=SUM')) return false;
        const hasInitiator = Boolean(String(row[initIdx] ?? '').trim());
        const hasTitle = Boolean(String(row[titleIdx] ?? '').trim());
        const hasAmount =
          amountIdx >= 0 && row[amountIdx] != null && row[amountIdx] !== '';
        const hasCode = Boolean(String(row[codeIdx] ?? '').trim()) && codeCell !== 'TOTAL';
        return !hasInitiator && !hasTitle && !hasAmount && !hasCode;
      };

      let insertAt = -1;
      // Skip TOTAL at index 0
      for (let r = 1; r < data.length; r++) {
        if (isBlankWorkingRow(data[r] || [])) {
          insertAt = r;
          break;
        }
      }

      if (insertAt >= 0) {
        data[insertAt] = newRow;
      } else {
        data.push(newRow);
      }
      data = ensureTotalAtTop(headers, data);

      const updated = await excelFilesApi.update(file.id, {
        name: file.name,
        headers,
        data,
        cashier: user,
      });

      openEditor(updated);
      setHint(
        `Месячный файл «${updated.name}»: строка ERP № ${fill.regNo || fill.erpId}` +
          (fill.code ? `, код ${fill.code}` : '') +
          ' добавлена (Дал деньги).',
      );
    },
    [openEditor, user],
  );

  const autofillLockRef = useRef<string | null>(null);

  const handleErpAutofill = useCallback(async () => {
    const fill = peekExcelAutofill();
    if (!fill) return;

    const lockKey = `${fill.erpId}:${fill.regNo}:${fill.code}`;
    if (autofillLockRef.current === lockKey) return;
    autofillLockRef.current = lockKey;

    setBusy(true);
    setListError('');
    setHint('Заполняем месячный Excel файл…');
    try {
      const res = await excelFilesApi.list();
      const monthName = monthlyCashierFileName();

      const candidates = res.files.filter(
        (f) =>
          f.id !== ERP_EXCEL_FILE_ID &&
          !/^ERP\s/i.test(f.name) &&
          !f.name.includes('Согласовано'),
      );

      const target =
        candidates.find((f) => f.name === monthName) ||
        candidates.find((f) => isCashierSheetForMonth(f.name)) ||
        null;

      let file: ExcelFile;
      if (target) {
        file = await excelFilesApi.get(target.id);
      } else {
        file = await excelFilesApi.create({
          name: monthName,
          headers: [...BASE_HEADERS],
          data: buildInitialData(),
          cashier: user,
        });
      }

      // Prefer canonical monthly name if we opened a legacy daily sheet for this month
      if (file.name !== monthName && isCashierSheetForMonth(file.name)) {
        file = await excelFilesApi.update(file.id, {
          name: monthName,
          cashier: user,
        });
      }

      await applyAutofillToFile(file, fill);
      clearExcelAutofill();
      await refreshFiles();
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : 'Не удалось заполнить Excel из ERP',
      );
      autofillLockRef.current = null;
    } finally {
      setBusy(false);
      if ((location.state as { fromErpCashOut?: boolean } | null)?.fromErpCashOut) {
        navigate('/excel', { replace: true, state: {} });
      }
    }
  }, [applyAutofillToFile, user, refreshFiles, location.state, navigate]);

  useEffect(() => {
    const state = location.state as { fromErpCashOut?: boolean } | null;
    const pending = sessionStorage.getItem(EXCEL_AUTOFILL_KEY);
    if (!state?.fromErpCashOut && !pending) return;
    void handleErpAutofill();
  }, [location.state, handleErpAutofill]);

  const createNewFile = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const name = newFileName.trim() || monthlyCashierFileName();
      setBusy(true);
      setListError('');
      try {
        const file = await excelFilesApi.create({
          name,
          headers: [...BASE_HEADERS],
          data: buildInitialData(),
          cashier: user,
        });
        setNewFileName('');
        setShowNewBox(false);
        await refreshFiles();
        openEditor(file);
      } catch (err) {
        setListError(err instanceof Error ? err.message : 'Не удалось создать файл');
      } finally {
        setBusy(false);
      }
    },
    [newFileName, user, refreshFiles, openEditor],
  );

  const downloadFileById = useCallback(
    async (id: string, fallbackName: string) => {
      setBusy(true);
      setListError('');
      try {
        const file = await excelFilesApi.get(id);
        downloadSheetAsExcel(
          file.name || fallbackName,
          file.headers?.length ? file.headers : [...BASE_HEADERS],
          file.data || [],
        );
        setHint(`Скачан: ${file.name}.xlsx`);
      } catch (err) {
        setListError(err instanceof Error ? err.message : 'Не удалось скачать файл');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const openExisting = useCallback(
    async (id: string) => {
      setBusy(true);
      setListError('');
      try {
        const file = await excelFilesApi.get(id);
        openEditor(file);
      } catch (err) {
        setListError(err instanceof Error ? err.message : 'Не удалось открыть файл');
      } finally {
        setBusy(false);
      }
    },
    [openEditor],
  );

  const syncErp = useCallback(async () => {
    setErpSyncing(true);
    setListError('');
    try {
      const result = await erpApi.sync(
        user ? { id: user.id, name: user.name } : undefined,
      );
      await refreshFiles();
      const parts = [
        `${result.count} строк`,
        `счета ${result.invoiceCount}`,
        `поездки ${result.tripCount}`,
      ];
      if (result.invoices.skipped && result.invoices.reason) {
        parts.push(`счета пропущены: ${result.invoices.reason}`);
      }
      setHint(`ERP синхронизирован → ${result.file.name} (${parts.join(' · ')})`);
      openEditor(result.file as ExcelFile);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Ошибка синхронизации ERP');
    } finally {
      setErpSyncing(false);
    }
  }, [user, refreshFiles, openEditor]);

  const backToList = useCallback(() => {
    setView('list');
    setActiveFile(null);
    void refreshFiles();
  }, [refreshFiles]);

  const persist = useCallback(async (opts?: { auto?: boolean }) => {
    const hot = hotRef.current?.hotInstance;
    const file = activeFileRef.current;
    if (!hot || !file) return;
    if (savingRef.current) {
      if (opts?.auto) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          void persist({ auto: true });
        }, 600);
      }
      return;
    }

    const payload = readVisualSheet(hot);
    savingRef.current = true;
    if (!opts?.auto) setBusy(true);
    else setHint('Сохранение…');

    try {
      const updated = await excelFilesApi.update(file.id, {
        name: fileNameRef.current.trim() || file.name,
        headers: payload.headers,
        data: payload.data,
        cashier: userRef.current,
      });
      setActiveFile(updated);
      setFileName(updated.name);
      setSavedAt(format(new Date(), 'HH:mm:ss'));
      setHint(
        opts?.auto
          ? `Автосохранено ${format(new Date(), 'HH:mm:ss')}`
          : 'Файл сохранён в системе.',
      );

      if (!opts?.auto) {
        setHeaders(payload.headers);
        setColumns(columnsFromHeaders(payload.headers));
        setSheetData(payload.data);
        await refreshFiles();
      }
    } catch (err) {
      setHint(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      savingRef.current = false;
      if (!opts?.auto) setBusy(false);
    }
  }, [refreshFiles]);

  const scheduleAutoSave = useCallback(() => {
    if (!activeFileRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setHint('Скоро сохранение…');
    saveTimerRef.current = setTimeout(() => {
      void persist({ auto: true });
    }, 900);
  }, [persist]);

  // Auto-save when the file name is edited
  useEffect(() => {
    if (view !== 'editor' || !activeFile) return;
    if (fileName.trim() === activeFile.name) return;
    scheduleAutoSave();
  }, [fileName, view, activeFile, scheduleAutoSave]);

  const downloadExcel = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    const payload = hot ? readVisualSheet(hot) : { headers, data: sheetData };
    downloadSheetAsExcel(fileName || activeFile?.name || 'cashier-sheet', payload.headers, payload.data);
    setHint('Excel файл скачан (.xlsx).');
  }, [headers, sheetData, fileName, activeFile?.name]);

  const addRows = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    // Insert after TOTAL (row 0)
    hot.alter('insert_row_below', 0, 10);
    const amountCol = findColAny(hot, 'Сумма', 'Amount');
    const codeCol = findColAny(hot, 'Код', 'Code');
    if (amountCol >= 0) {
      hot.setDataAtCell(
        0,
        amountCol,
        sumFormulaForSheet(amountCol, hot.countRows()),
        'row-add',
      );
      if (codeCol >= 0) hot.setDataAtCell(0, codeCol, 'TOTAL', 'row-add');
    }
    setHint('Добавлено 10 строк.');
    scheduleAutoSave();
  }, [scheduleAutoSave]);

  const addColumn = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const name = columnName.trim();
      if (!name) {
        setHint('Сначала введите имя столбца.');
        return;
      }
      if (headers.some((h) => h.toLowerCase() === name.toLowerCase())) {
        setHint(`Столбец «${name}» уже существует.`);
        return;
      }

      const hot = hotRef.current?.hotInstance;
      const current = hot ? readVisualSheet(hot) : { headers, data: sheetData };
      const nextHeaders = [...current.headers, name];
      const nextData = current.data.map((row) => [...row, '']);

      setHeaders(nextHeaders);
      setColumns(columnsFromHeaders(nextHeaders));
      setSheetData(nextData);
      setTableKey((k) => k + 1);
      setColumnName('');
      setHint(`Столбец «${name}» добавлен.`);
      scheduleAutoSave();
    },
    [columnName, headers, sheetData, scheduleAutoSave],
  );

  const afterChange = useCallback(
    function (
      this: Handsontable.Core,
      changes: Handsontable.CellChange[] | null,
      source: Handsontable.ChangeSource,
    ) {
      const src = String(source);
      if (!changes || src === 'loadData') return;

      if (src !== 'code-autofill' && src !== 'row-add' && src !== 'worker-autofill') {
        const codeCol = findColAny(this, 'Код', 'Code');
        const workerCol = findColAny(this, 'Инициатор', 'Сотрудник', 'Worker');
        for (const [row, prop, , newValue] of changes) {
          const col = typeof prop === 'number' ? prop : Number(prop);
          // Skip TOTAL row at top
          if (row === 0) continue;
          if (codeCol >= 0 && col === codeCol) {
            fillFromCode(this, row, newValue);
          }
          if (workerCol >= 0 && col === workerCol) {
            normalizeWorkerCell(this, row, newValue);
          }
        }
      }

      scheduleAutoSave();
    },
    [scheduleAutoSave],
  );

  const afterColumnMove = useCallback(
    (
      _movedColumns: number[],
      _finalIndex: number,
      _dropIndex: number | undefined,
      movePossible: boolean,
      orderChanged: boolean,
    ) => {
      if (!movePossible || !orderChanged) return;
      const hot = hotRef.current?.hotInstance;
      if (!hot) return;
      const visual = readVisualSheet(hot);
      setHeaders(visual.headers);
      setColumns(columnsFromHeaders(visual.headers));
      setSheetData(visual.data);
      setTableKey((k) => k + 1);
      setHint('Порядок столбцов обновлён.');
      scheduleAutoSave();
    },
    [scheduleAutoSave],
  );

  const afterRowMove = useCallback(
    (
      _movedRows: number[],
      _finalIndex: number,
      _dropIndex: number | undefined,
      movePossible: boolean,
      orderChanged: boolean,
    ) => {
      if (!movePossible || !orderChanged) return;
      setHint('Порядок строк обновлён.');
      scheduleAutoSave();
    },
    [scheduleAutoSave],
  );

  const applySheetSearch = useCallback((query: string, hideNonMatches: boolean) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    const searchPlugin = hot.getPlugin('search');
    const hiddenRows = hot.getPlugin('hiddenRows');
    const q = query.trim();

    // Show all rows first
    if (hiddenRows?.isEnabled?.() || hiddenRows) {
      const previouslyHidden = [...(hiddenRows.getHiddenRows?.() || [])];
      if (previouslyHidden.length) hiddenRows.showRows(previouslyHidden);
    }

    if (!q) {
      searchPlugin?.query?.('');
      setSearchHitCount(0);
      hot.render();
      return;
    }

    const results = (searchPlugin?.query?.(q) || []) as { row: number; col: number }[];
    setSearchHitCount(results.length);

    if (hideNonMatches && hiddenRows) {
      const matchRows = new Set(results.map((r) => r.row));
      const last = hot.countRows() - 1;
      const toHide: number[] = [];
      for (let r = 0; r < last; r++) {
        if (!matchRows.has(r)) toHide.push(r);
      }
      if (toHide.length) hiddenRows.hideRows(toHide);
    }

    hot.render();
    if (results.length) {
      hot.selectCell(results[0].row, results[0].col);
      setHint(`Найдено: ${results.length}`);
    } else {
      setHint('Ничего не найдено');
    }
  }, []);

  useEffect(() => {
    if (view !== 'editor') return;
    const t = setTimeout(() => applySheetSearch(sheetSearch, onlyMatches), 180);
    return () => clearTimeout(t);
  }, [sheetSearch, onlyMatches, view, tableKey, applySheetSearch]);

  const clearSheetSearch = useCallback(() => {
    setSheetSearch('');
    setOnlyMatches(false);
    setSearchHitCount(0);
    applySheetSearch('', false);
    setHint('Поиск сброшен');
  }, [applySheetSearch]);

  const clearColumnFilters = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const filters = hot.getPlugin('filters');
    filters?.clearConditions?.();
    filters?.filter?.();
    hot.render();
    setHint('Фильтры столбцов сброшены');
  }, []);

  const openRowForm = useCallback(() => {
    if (!activeFileRef.current) {
      setHint('Сначала откройте файл Excel');
      return;
    }
    // Always use React headers (Handsontable getColHeader can be polluted by filters UI)
    const currentHeaders = headers.length ? headers : [...BASE_HEADERS];
    const initial: Record<string, string> = {};
    for (const h of currentHeaders) {
      if (h === 'Дата' || h === 'Date') initial[h] = format(new Date(), 'yyyy-MM-dd');
      else if (h === 'Статус' || h === 'Status') initial[h] = 'Согласовано';
      else if (h === 'Филиал' || h === 'Branch') {
        initial[h] = user?.branchLabel || BRANCH_OPTIONS[0] || '';
      } else if (h === 'Форма оплаты' || h === 'Оплата' || h === 'Payment') {
        initial[h] = 'Наличные';
      } else initial[h] = '';
    }
    setRowForm(initial);
    setCodeSuggestOpen(false);
    setRowFormOpen(true);
  }, [headers, user?.branchLabel]);

  const setRowFormField = useCallback((header: string, value: string) => {
    setRowForm((prev) => {
      const next = { ...prev, [header]: value };
      if (header === 'Код' || header === 'Code') {
        const account = getAccountByCode(value.trim().toUpperCase());
        if (account) {
          next[header] = account.code;
          const titleKey = 'Наименование' in next ? 'Наименование' : null;
          if (titleKey && !String(next[titleKey] || '').trim()) {
            next[titleKey] =
              displayName(account, 'ru') ||
              displayName(account, 'uz') ||
              displayName(account, 'en') ||
              '';
          }
        }
      }
      return next;
    });
  }, []);

  const submitRowForm = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const file = activeFileRef.current;
      if (!file) {
        setHint('Сначала откройте файл Excel');
        return;
      }

      const currentHeaders = headers.length ? headers : [...BASE_HEADERS];

      // Meaningful fields — ignore auto defaults (date/status/branch/pay)
      const meaningful = ['Инициатор', 'Сотрудник', 'Worker', 'Наименование', 'Сумма', 'Amount', 'Код', 'Code', 'Примечание', 'Note'];
      const hasMeaningful = meaningful.some((h) => String(rowForm[h] ?? '').trim());
      const hasAny = currentHeaders.some((h) => String(rowForm[h] ?? '').trim());
      if (!hasAny) {
        setHint('Заполните хотя бы одно поле');
        return;
      }
      if (!hasMeaningful) {
        setHint('Укажите инициатора, наименование, сумму или код');
        return;
      }

      setRowFormBusy(true);
      try {
        // Cancel pending autosave so it cannot overwrite this write
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }

        const hot = hotRef.current?.hotInstance;
        const fromHot = hot ? readVisualSheet(hot) : null;
        const clean = sanitizeSheet({
          headers: fromHot?.headers?.length ? fromHot.headers : currentHeaders,
          data: fromHot?.data?.length
            ? fromHot.data
            : sheetData.length
              ? sheetData
              : buildInitialData(currentHeaders.length),
        });

        let nextHeaders = clean.headers;
        for (const h of BASE_HEADERS) {
          if (!nextHeaders.includes(h)) nextHeaders = [...nextHeaders, h];
        }

        let data = clean.data.map((r) => {
          const row = [...r];
          while (row.length < nextHeaders.length) {
            row.push(row.length === nextHeaders.indexOf('Сумма') ? null : '');
          }
          return row;
        });
        data = ensureTotalAtTop(nextHeaders, data);

        const amountIdx = nextHeaders.indexOf('Сумма') >= 0
          ? nextHeaders.indexOf('Сумма')
          : nextHeaders.indexOf('Amount');
        const codeIdx =
          nextHeaders.indexOf('Код') >= 0
            ? nextHeaders.indexOf('Код')
            : nextHeaders.indexOf('Code');
        const initIdx =
          nextHeaders.indexOf('Инициатор') >= 0
            ? nextHeaders.indexOf('Инициатор')
            : nextHeaders.indexOf('Сотрудник');
        const titleIdx = nextHeaders.indexOf('Наименование');

        const isBlankWorkingRow = (row: (string | number | null)[]) => {
          const codeCell = String(row[codeIdx] ?? '').toUpperCase();
          if (codeCell === 'TOTAL') return false;
          if (String(row[amountIdx] ?? '').startsWith('=SUM')) return false;
          const hasInitiator = Boolean(String(row[initIdx] ?? '').trim());
          const hasTitle = Boolean(String(row[titleIdx] ?? '').trim());
          const hasAmount =
            amountIdx >= 0 && row[amountIdx] != null && row[amountIdx] !== '';
          const hasCode = Boolean(String(row[codeIdx] ?? '').trim()) && codeCell !== 'TOTAL';
          return !hasInitiator && !hasTitle && !hasAmount && !hasCode;
        };

        const newRow = nextHeaders.map((h) => {
          let raw = rowForm[h] ?? '';
          if (h === 'Сумма' || h === 'Amount') {
            const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
            return Number.isFinite(n) && String(raw).trim() ? n : null;
          }
          if (h === 'Код' || h === 'Code') return String(raw).trim().toUpperCase();
          return raw;
        });

        let insertAt = -1;
        for (let r = 1; r < data.length; r++) {
          if (isBlankWorkingRow(data[r] || [])) {
            insertAt = r;
            break;
          }
        }
        if (insertAt >= 0) {
          data[insertAt] = newRow;
        } else {
          data.push(newRow);
          insertAt = data.length - 1;
        }
        data = ensureTotalAtTop(nextHeaders, data);

        const updated = await excelFilesApi.update(file.id, {
          name: fileNameRef.current.trim() || file.name,
          headers: nextHeaders,
          data,
          cashier: userRef.current,
        });

        // Remount grid so the new row is always visible (clears filters/search hide)
        setActiveFile(updated);
        setFileName(updated.name);
        setHeaders(nextHeaders);
        setColumns(columnsFromHeaders(nextHeaders));
        setSheetData(data);
        setTableKey((k) => k + 1);
        setSheetSearch('');
        setOnlyMatches(false);
        setSearchHitCount(0);
        setSavedAt(format(new Date(), 'HH:mm:ss'));
        setHint(`Строка добавлена и сохранена (ряд ${insertAt + 1})`);
        setRowFormOpen(false);
        setRowForm({});
        await refreshFiles();
      } catch (err) {
        setHint(err instanceof Error ? err.message : 'Не удалось добавить строку');
      } finally {
        setRowFormBusy(false);
      }
    },
    [rowForm, headers, sheetData, refreshFiles],
  );

  const rowFormCodeMatches = useMemo(() => {
    const q = String(rowForm['Код'] || rowForm['Code'] || '').trim();
    return getActiveCodes()
      .filter((c) => /^[A-Z]\d+/i.test(c.code))
      .filter((c) => {
        if (!q) return true;
        const blob = `${c.code} ${displayName(c, 'ru')} ${displayName(c, 'uz')}`.toLowerCase();
        return blob.includes(q.toLowerCase());
      })
      .slice(0, 30);
  }, [rowForm]);

  const customHeaders = headers.filter((h) => !BASE_HEADERS.includes(h));

  if (view === 'list') {
    return (
      <div className="page excel-page">
        <header className="page-header">
          <div>
            <h1>Excel файлы</h1>
            <p className="muted">
              Месячные кассовые листы (автосоздание каждый месяц) · Скачивание .xlsx · Синхронизация
              ERP · {ACCOUNT_CODES.length} кодов счетов
            </p>
          </div>
          <div className="excel-actions">
            <button
              type="button"
              className="btn"
              onClick={() => void syncErp()}
              disabled={busy || erpSyncing}
              title="Загрузить подтверждённые счета ERP (Согласовано) в Excel"
            >
              <RefreshCw size={16} className={erpSyncing ? 'spin' : undefined} />
              {erpSyncing ? 'Синхронизация ERP…' : 'Синхр. ERP'}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => setShowNewBox(true)}
              disabled={busy}
            >
              <Plus size={16} />
              Новый файл
            </button>
          </div>
        </header>

        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat accent">
            <div className="stat-label">
              <FileSpreadsheet size={18} />
              Файлов в системе
            </div>
            <div className="stat-value">{listLoading ? '…' : fileCount}</div>
          </div>
        </div>

        {showNewBox && (
          <form className="excel-add-column panel" onSubmit={(e) => void createNewFile(e)}>
            <Sheet size={18} />
            <label className="excel-add-column-field">
              <span>Имя нового файла</span>
              <input
                autoFocus
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder={`напр. ${monthlyCashierFileName()}`}
                maxLength={120}
              />
            </label>
            <button type="submit" className="btn primary" disabled={busy}>
              <Plus size={16} />
              {busy ? 'Создание…' : 'Создать и открыть'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setShowNewBox(false);
                setNewFileName('');
              }}
            >
              Отмена
            </button>
          </form>
        )}

        {listError && <div className="alert error">{listError}</div>}

        <section className="panel">
          <div className="panel-head">
            <h2>Все файлы</h2>
            <button type="button" className="text-link" onClick={() => void refreshFiles()}>
              Обновить
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Обновлён</th>
                  <th>Кем</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {listLoading && (
                  <tr>
                    <td colSpan={4} className="empty">
                      Загрузка файлов…
                    </td>
                  </tr>
                )}
                {!listLoading && files.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">
                      Excel файлов пока нет. Месячный файл «{monthlyCashierFileName()}» создаётся
                      автоматически при открытии списка.
                    </td>
                  </tr>
                )}
                {files.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <div className="cell-title">
                        {f.name}
                        {f.name === monthlyCashierFileName() ? (
                          <span className="cell-sub" style={{ display: 'inline', marginLeft: 8 }}>
                            · текущий месяц
                          </span>
                        ) : null}
                      </div>
                      <div className="cell-sub">{f.id}</div>
                    </td>
                    <td>{format(new Date(f.updatedAt), 'dd MMM yyyy HH:mm')}</td>
                    <td>{f.updatedByName || f.createdByName || '—'}</td>
                    <td>
                      <div className="excel-actions">
                        <button
                          type="button"
                          className="btn primary"
                          disabled={busy}
                          onClick={() => void openExisting(f.id)}
                        >
                          <FolderOpen size={16} />
                          Открыть
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          title="Скачать .xlsx"
                          onClick={() => void downloadFileById(f.id, f.name)}
                        >
                          <Download size={16} />
                          Скачать
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page excel-page">
      <header className="page-header">
        <div>
          <button type="button" className="text-link" onClick={backToList} style={{ marginBottom: 8 }}>
            <ArrowLeft size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Все файлы ({fileCount})
          </button>
          <label className="excel-file-name-field">
            <span className="muted">Имя файла</span>
            <input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="Имя файла"
            />
          </label>
        </div>
        <div className="excel-actions">
          <button type="button" className="btn primary" onClick={openRowForm} disabled={busy}>
            <ClipboardPlus size={16} />
            Добавить запись
          </button>
          <button type="button" className="btn" onClick={addRows}>
            <Plus size={16} />
            Строки
          </button>
          <button type="button" className="btn" onClick={downloadExcel}>
            <Download size={16} />
            Скачать Excel
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void persist()}>
            <Save size={16} />
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </header>

      <div className="excel-toolbar panel">
        <div className="excel-toolbar-left">
          <Sheet size={18} />
          <span>
            Касса {user?.counterId} · {user?.name}
          </span>
          {savedAt && <span className="muted">Сохранено {savedAt}</span>}
          {hint && <span className="excel-hint">{hint}</span>}
        </div>
        <div className="excel-legend">
          <span className="chip method-cash">Фильтр: ▼ в заголовке столбца</span>
          <span className="chip method-card">Автосохранение после правки</span>
          <span className="chip method-transfer">Автодополнение кода и сотрудника</span>
        </div>
      </div>

      <div className="excel-search-bar panel">
        <Search size={16} />
        <input
          value={sheetSearch}
          onChange={(e) => setSheetSearch(e.target.value)}
          placeholder="Поиск по таблице (имя, код, сумма, филиал…)"
          aria-label="Поиск в Excel"
        />
        {sheetSearch && (
          <span className="muted excel-search-count">
            {searchHitCount > 0 ? `${searchHitCount} совп.` : 'нет'}
          </span>
        )}
        <label className="excel-search-only">
          <input
            type="checkbox"
            checked={onlyMatches}
            onChange={(e) => setOnlyMatches(e.target.checked)}
            disabled={!sheetSearch.trim()}
          />
          Только совпадения
        </label>
        <button
          type="button"
          className="btn"
          disabled={!sheetSearch && searchHitCount === 0}
          onClick={clearSheetSearch}
          title="Сбросить поиск"
        >
          <X size={16} />
          Сброс
        </button>
        <button
          type="button"
          className="btn"
          onClick={clearColumnFilters}
          title="Сбросить фильтры столбцов"
        >
          Сброс фильтров
        </button>
      </div>

      <form className="excel-add-column panel" onSubmit={addColumn}>
        <Columns3 size={18} />
        <label className="excel-add-column-field">
          <span>Имя нового столбца</span>
          <input
            value={columnName}
            onChange={(e) => setColumnName(e.target.value)}
            placeholder="Введите имя столбца…"
            maxLength={60}
          />
        </label>
        <button type="submit" className="btn primary">
          <Plus size={16} />
          Добавить столбец
        </button>
        {customHeaders.length > 0 && (
          <div className="excel-custom-cols">
            {customHeaders.map((h) => (
              <span key={h} className="chip method-transfer" title="Удалить столбец может только админ">
                {h}
              </span>
            ))}
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              Удаление столбцов — только админ
            </span>
          </div>
        )}
      </form>

      <div className="excel-codes-strip panel">
        <strong>Быстрые коды:</strong>
        {getActiveCodes()
          .filter((c) => /^[A-Z]\d+$/i.test(c.code))
          .slice(0, 18)
          .map((c) => (
            <button
              key={c.code}
              type="button"
              className="code-chip-btn"
              title={`${displayName(c, 'en')} · ${c.uzbek || c.russian}`}
              onClick={() => {
                const hot = hotRef.current?.hotInstance;
                if (!hot) return;
                const selected = hot.getSelectedLast();
                const row = selected ? selected[0] : 0;
                if (row === 0) return;
                const codeCol = findColAny(hot, 'Код', 'Code');
                if (codeCol < 0) return;
                hot.selectCell(row, codeCol);
                fillFromCode(hot, row, c.code);
                setHint(`Вставлен код ${c.code}`);
              }}
            >
              {c.code}
            </button>
          ))}
      </div>

      <div className="excel-grid-wrap panel">
        <HotTable
          key={tableKey}
          ref={hotRef}
          themeName="ht-theme-main"
          data={sheetData}
          colHeaders={headers}
          columns={columns}
          rowHeaders
          height="calc(100vh - 400px)"
          width="100%"
          stretchH="all"
          licenseKey="non-commercial-and-evaluation"
          formulas={{ engine: hyperformula }}
          contextMenu={[
            'row_above',
            'row_below',
            '---------',
            'undo',
            'redo',
            '---------',
            'copy',
            'cut',
            'paste',
          ]}
          beforeRemoveCol={() => {
            setHint('Удаление столбцов доступно только администратору');
            return false;
          }}
          beforeRemoveRow={() => {
            setHint('Удаление строк доступно только администратору');
            return false;
          }}
          manualColumnResize
          manualRowResize
          manualColumnMove
          manualRowMove
          copyPaste
          undoRedo
          search
          filters
          dropdownMenu={[
            'filter_by_condition',
            'filter_operators',
            'filter_by_condition2',
            'filter_by_value',
            'filter_action_bar',
          ]}
          hiddenRows={{ indicators: true }}
          autoWrapRow
          autoWrapCol
          afterChange={afterChange}
          afterColumnMove={afterColumnMove}
          afterRowMove={afterRowMove}
          cells={(row: number, col: number) => {
            const meta: Handsontable.CellMeta = {};
            const hot = hotRef.current?.hotInstance;
            const amountCol = hot ? findColAny(hot, 'Сумма', 'Amount') : COL.AMOUNT;
            const codeCol = hot ? findColAny(hot, 'Код', 'Code') : COL.CODE;
            const workerCol = hot
              ? findColAny(hot, 'Инициатор', 'Сотрудник', 'Worker')
              : COL.INITIATOR;
            // TOTAL is always the first row
            if (row === 0) {
              meta.className = 'excel-total-row';
              meta.readOnly = col !== amountCol;
            }
            if (col === codeCol) meta.className = `${meta.className || ''} excel-code-col`;
            if (col === workerCol) meta.className = `${meta.className || ''} excel-worker-col`;
            return meta;
          }}
        />
      </div>

      {rowFormOpen && (
        <div className="modal-backdrop" onClick={() => !rowFormBusy && setRowFormOpen(false)}>
          <div
            className="modal excel-row-form-modal"
            style={{ width: 'min(560px, 100%)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-actions">
              <strong style={{ marginRight: 'auto' }}>Новая запись</strong>
              <button
                type="button"
                className="icon-btn"
                disabled={rowFormBusy}
                onClick={() => setRowFormOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <p className="muted" style={{ marginBottom: 12 }}>
              Заполните поля столбцов Excel и нажмите «Сохранить в таблицу» — строка добавится
              автоматически.
            </p>

            <form className="excel-row-form" onSubmit={(e) => void submitRowForm(e)}>
              {headers.map((h) => {
                const value = rowForm[h] ?? '';
                if (h === 'Дата' || h === 'Date') {
                  return (
                    <label key={h} className="field">
                      <span>{h}</span>
                      <input
                        type="date"
                        value={value}
                        onChange={(e) => setRowFormField(h, e.target.value)}
                      />
                    </label>
                  );
                }
                if (h === 'Статус' || h === 'Status') {
                  return (
                    <label key={h} className="field">
                      <span>{h}</span>
                      <select
                        value={value}
                        onChange={(e) => setRowFormField(h, e.target.value)}
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                }
                if (h === 'Филиал' || h === 'Branch') {
                  return (
                    <label key={h} className="field">
                      <span>{h}</span>
                      <select
                        value={value}
                        onChange={(e) => setRowFormField(h, e.target.value)}
                      >
                        {BRANCH_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                }
                if (h === 'Форма оплаты' || h === 'Оплата' || h === 'Payment') {
                  return (
                    <label key={h} className="field">
                      <span>{h}</span>
                      <select
                        value={value}
                        onChange={(e) => setRowFormField(h, e.target.value)}
                      >
                        {PAY_FORM_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                }
                if (h === 'Сумма' || h === 'Amount') {
                  return (
                    <label key={h} className="field">
                      <span>{h}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={value}
                        onChange={(e) => setRowFormField(h, e.target.value)}
                        placeholder="0"
                      />
                    </label>
                  );
                }
                if (h === 'Инициатор' || h === 'Сотрудник' || h === 'Worker') {
                  return (
                    <label key={h} className="field">
                      <span>{h}</span>
                      <input
                        list="excel-row-workers"
                        value={value}
                        onChange={(e) => setRowFormField(h, e.target.value)}
                        placeholder="ФИО"
                        autoComplete="off"
                      />
                      <datalist id="excel-row-workers">
                        {workersCache.slice(0, 300).map((w) => (
                          <option key={String(w.id)} value={w.fullName} />
                        ))}
                      </datalist>
                    </label>
                  );
                }
                if (h === 'Код' || h === 'Code') {
                  return (
                    <label key={h} className="field" style={{ position: 'relative' }}>
                      <span>{h}</span>
                      <input
                        value={value}
                        onChange={(e) => {
                          setRowFormField(h, e.target.value);
                          setCodeSuggestOpen(true);
                        }}
                        onFocus={() => setCodeSuggestOpen(true)}
                        placeholder="A1, код счёта…"
                        autoComplete="off"
                      />
                      {codeSuggestOpen && rowFormCodeMatches.length > 0 && (
                        <div className="erp-code-dropdown">
                          {rowFormCodeMatches.map((c) => (
                            <button
                              key={c.code}
                              type="button"
                              className="erp-code-option"
                              onClick={() => {
                                setRowFormField(h, c.code);
                                setCodeSuggestOpen(false);
                              }}
                            >
                              <code>{c.code}</code>
                              <span>
                                {displayName(c, 'ru') ||
                                  displayName(c, 'uz') ||
                                  displayName(c, 'en')}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </label>
                  );
                }
                return (
                  <label key={h} className="field">
                    <span>{h}</span>
                    <input
                      value={value}
                      onChange={(e) => setRowFormField(h, e.target.value)}
                      placeholder={h}
                    />
                  </label>
                );
              })}

              <div className="excel-row-form-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={rowFormBusy}
                  onClick={() => setRowFormOpen(false)}
                >
                  Отмена
                </button>
                <button type="submit" className="btn primary" disabled={rowFormBusy}>
                  <Save size={16} />
                  {rowFormBusy ? 'Сохранение…' : 'Сохранить в таблицу'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
