import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { HotTable } from '@handsontable/react-wrapper';
import { registerAllModules } from 'handsontable/registry';
import { HyperFormula } from 'hyperformula';
import type { HotTableRef } from '@handsontable/react-wrapper';
import { ArrowLeft, Plus, Save, Shield, Trash2 } from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { adminApi, type AdminExcelFile } from '../../api/adminApi';
import { HOSPITAL_NAME } from '../../api/config';
import 'handsontable/styles/handsontable.min.css';
import 'handsontable/styles/ht-theme-main.min.css';

registerAllModules();

function readHeaders(hot: NonNullable<HotTableRef['hotInstance']>): string[] {
  return Array.from({ length: hot.countCols() }, (_, c) => {
    const h = hot.getColHeader(c);
    return typeof h === 'string' && h.trim() ? h : `Col${c + 1}`;
  });
}

export function AdminExcelEditPage() {
  const { admin } = useAdminAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const hotRef = useRef<HotTableRef>(null);

  const [file, setFile] = useState<AdminExcelFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetData, setSheetData] = useState<(string | number | null)[][]>([]);
  const [tableKey, setTableKey] = useState(0);
  const [newColName, setNewColName] = useState('');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const f = await adminApi.getExcelFile(id);
      setFile(f);
      setFileName(f.name);
      setHeaders(f.headers);
      setSheetData(f.data);
      setTableKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить файл');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (admin) void load();
  }, [admin, load]);

  const columns = useMemo(
    () => headers.map(() => ({ type: 'text' as const })),
    [headers],
  );

  const syncFromHot = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    setHeaders(readHeaders(hot));
    setSheetData(hot.getData() as (string | number | null)[][]);
  }, []);

  const deleteColumn = useCallback(
    (name: string) => {
      const idx = headers.indexOf(name);
      if (idx < 0) return;
      if (!confirm(`Удалить столбец «${name}»? Данные в столбце будут потеряны.`)) return;

      const nextHeaders = headers.filter((_, i) => i !== idx);
      const nextData = sheetData.map((row) => row.filter((_, i) => i !== idx));
      setHeaders(nextHeaders);
      setSheetData(nextData);
      setTableKey((k) => k + 1);
      setHint(`Столбец «${name}» удалён. Нажмите «Сохранить».`);
    },
    [headers, sheetData],
  );

  const addColumn = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const name = newColName.trim();
      if (!name) {
        setHint('Введите имя столбца');
        return;
      }
      if (headers.some((h) => h.toLowerCase() === name.toLowerCase())) {
        setHint(`Столбец «${name}» уже есть`);
        return;
      }
      setHeaders([...headers, name]);
      setSheetData(sheetData.map((row) => [...row, '']));
      setTableKey((k) => k + 1);
      setNewColName('');
      setHint(`Столбец «${name}» добавлен. Нажмите «Сохранить».`);
    },
    [headers, sheetData, newColName],
  );

  async function save() {
    if (!id) return;
    setSaving(true);
    setError('');
    setHint('');
    try {
      const hot = hotRef.current?.hotInstance;
      const nextHeaders = hot ? readHeaders(hot) : headers;
      const data = (hot?.getData() as (string | number | null)[][]) || sheetData;
      const updated = await adminApi.updateExcelFile(id, {
        name: fileName.trim() || file?.name,
        headers: nextHeaders,
        data,
      });
      setFile(updated);
      setHeaders(updated.headers);
      setSheetData(updated.data);
      setTableKey((k) => k + 1);
      setHint('Сохранено.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  if (!admin) return <Navigate to="/admin/login" replace />;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand">
          <div className="brand-mark admin-mark">
            <Shield size={22} />
          </div>
          <div>
            <div className="brand-name">{HOSPITAL_NAME}</div>
            <div className="brand-sub">Редактирование Excel файла</div>
          </div>
        </div>
        <button type="button" className="btn ghost full" onClick={() => navigate('/admin')}>
          <ArrowLeft size={16} />
          Назад в админку
        </button>
        <Link to="/login" className="text-link" style={{ textAlign: 'center', color: '#cfe0f0' }}>
          Вход кассира
        </Link>
      </aside>

      <main className="admin-main">
        <header className="page-header">
          <div>
            <h1>Редактирование таблицы</h1>
            <p className="muted">
              {file
                ? `Последнее изменение: ${file.updatedByName || '—'} · Создал: ${file.createdByName || '—'}`
                : 'Загрузка…'}
            </p>
          </div>
          <button type="button" className="btn primary" disabled={saving || loading} onClick={() => void save()}>
            <Save size={16} />
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </header>

        {error && <div className="alert error">{error}</div>}
        {hint && <div className="excel-hint" style={{ marginBottom: 12 }}>{hint}</div>}

        {!loading && file && (
          <>
            <label className="field" style={{ maxWidth: 420, marginBottom: 12 }}>
              <span>Имя файла</span>
              <input value={fileName} onChange={(e) => setFileName(e.target.value)} />
            </label>

            <form className="excel-add-column panel" onSubmit={(e) => void addColumn(e)}>
              <label className="excel-add-column-field">
                <span>Новый столбец</span>
                <input
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  placeholder="Имя столбца…"
                  maxLength={60}
                />
              </label>
              <button type="submit" className="btn primary">
                <Plus size={16} />
                Добавить столбец
              </button>
            </form>

            {headers.length > 0 && (
              <div className="excel-custom-cols panel" style={{ marginBottom: 12 }}>
                <strong style={{ marginRight: 8 }}>Столбцы (удаление — только админ):</strong>
                {headers.map((h) => (
                  <span key={h} className="chip method-transfer" style={{ gap: 6 }}>
                    {h}
                    <button
                      type="button"
                      className="icon-btn"
                      title={`Удалить столбец «${h}»`}
                      aria-label={`Удалить столбец ${h}`}
                      onClick={() => deleteColumn(h)}
                      style={{ width: 22, height: 22, padding: 0 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="excel-sheet-wrap panel">
              <HotTable
                key={tableKey}
                ref={hotRef}
                data={sheetData}
                colHeaders={headers}
                columns={columns}
                rowHeaders
                height="calc(100vh - 280px)"
                width="100%"
                stretchH="all"
                licenseKey="non-commercial-and-evaluation"
                formulas={{ engine: HyperFormula }}
                contextMenu
                manualColumnResize
                afterChange={(changes: unknown, source: string) => {
                  if (!changes || source === 'loadData') return;
                  const hot = hotRef.current?.hotInstance;
                  if (hot) setSheetData(hot.getData() as (string | number | null)[][]);
                }}
                afterRemoveCol={() => {
                  syncFromHot();
                  setHint('Столбец удалён. Нажмите «Сохранить».');
                }}
                afterRemoveRow={() => {
                  syncFromHot();
                  setHint('Строка удалена. Нажмите «Сохранить».');
                }}
                afterCreateCol={() => {
                  syncFromHot();
                  setHint('Столбец добавлен. Нажмите «Сохранить».');
                }}
                afterCreateRow={() => {
                  syncFromHot();
                  setHint('Строка добавлена. Нажмите «Сохранить».');
                }}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
