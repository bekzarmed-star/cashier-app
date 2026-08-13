import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookMarked, Plus, Search, X } from 'lucide-react';
import {
  ACCOUNT_CODES,
  ACCOUNT_GROUPS,
  searchAccountCodes,
  upsertAccountCode,
} from '../data/accountCodes';
import { codesApi } from '../api/codesApi';
import { displayName, isParentCode } from '../types/accountCode';
import type { AccountCode } from '../types/accountCode';

type GroupFilter = 'all' | 'Расход' | 'Прочий приход';

const EMPTY_FORM = {
  code: '',
  russian: '',
  uzbek: '',
  english: '',
  note: '',
  group: 'Расход' as string,
};

export function CodesPage() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<GroupFilter>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<AccountCode | null>(null);
  const [codesVersion, setCodesVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await codesApi.refreshRuntime();
      setCodesVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить коды');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const results = useMemo(() => {
    void codesVersion;
    return searchAccountCodes(query, {
      includeArchived: showArchived,
      group: group === 'all' ? undefined : group,
    });
  }, [query, group, showArchived, codesVersion]);

  async function submitNewCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setHint('');
    try {
      const created = await codesApi.create({
        code: form.code,
        russian: form.russian,
        uzbek: form.uzbek,
        english: form.english,
        note: form.note,
        group: form.group,
      });
      upsertAccountCode(created);
      setCodesVersion((v) => v + 1);
      setSelected(created);
      setForm({ ...EMPTY_FORM });
      setFormOpen(false);
      setHint(`Код «${created.code}» добавлен`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить код');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Коды счетов</h1>
          <p className="muted">
            План счетов · {ACCOUNT_CODES.length} кодов
            {loading ? ' · загрузка…' : ''}
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setFormOpen(true);
            setError('');
            setHint('');
          }}
        >
          <Plus size={16} />
          Добавить код
        </button>
      </header>

      {error && <div className="alert error">{error}</div>}
      {hint && <div className="excel-hint" style={{ marginBottom: 12 }}>{hint}</div>}

      <div className="collect-layout">
        <section className="panel">
          <div className="search-bar">
            <Search size={16} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по коду (напр. C8, P5) или названию…"
            />
          </div>

          <div className="codes-filters">
            <div className="method-tabs codes-tabs">
              <button
                type="button"
                className={group === 'all' ? 'active' : ''}
                onClick={() => setGroup('all')}
              >
                Все
              </button>
              {ACCOUNT_GROUPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={group === g ? 'active' : ''}
                  onClick={() => setGroup(g)}
                >
                  {g}
                </button>
              ))}
            </div>
            <label className="check-inline">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Показать архив
            </label>
          </div>

          <div className="bill-list">
            {results.length === 0 && <div className="empty">Ничего не найдено.</div>}
            {results.map((c) => {
              const active = selected?.code === c.code;
              const parent = isParentCode(c.code);
              return (
                <button
                  key={c.code}
                  type="button"
                  className={`bill-row ${active ? 'active' : ''} ${parent ? 'code-parent' : ''}`}
                  onClick={() => setSelected(c)}
                >
                  <div>
                    <div className="cell-title">
                      <code className="code-badge">{c.code}</code>
                      {displayName(c, 'ru') || displayName(c, 'en')}
                      {c.archived && <span className="chip">архив</span>}
                    </div>
                    <div className="cell-sub">
                      {[c.uzbek, c.english].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="bill-row-right">
                    <span
                      className={`chip ${c.group === 'Прочий приход' ? 'method-cash' : 'method-card'}`}
                    >
                      {c.group === 'Прочий приход' ? 'приход' : 'расход'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel payment-panel">
          {!selected ? (
            <div className="empty tall">
              <BookMarked size={28} style={{ marginBottom: 8, opacity: 0.45 }} />
              <div>Выберите код, чтобы увидеть детали.</div>
              <div className="muted" style={{ marginTop: 6 }}>
                Или нажмите «Добавить код», чтобы создать новый.
              </div>
            </div>
          ) : (
            <CodeDetail code={selected} />
          )}
        </section>
      </div>

      {formOpen && (
        <div className="modal-backdrop" onClick={() => !busy && setFormOpen(false)}>
          <div
            className="modal"
            style={{ width: 'min(480px, 100%)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-actions">
              <strong style={{ marginRight: 'auto' }}>Новый код счёта</strong>
              <button
                type="button"
                className="icon-btn"
                disabled={busy}
                onClick={() => setFormOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form className="excel-row-form" onSubmit={(e) => void submitNewCode(e)}>
              <label className="field">
                <span>Код *</span>
                <input
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                  }
                  placeholder="A1, C8, P12…"
                  required
                  maxLength={20}
                  autoFocus
                />
              </label>
              <label className="field">
                <span>Группа</span>
                <select
                  value={form.group}
                  onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
                >
                  {ACCOUNT_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ gridColumn: '1 / -1' }}>
                <span>Русский *</span>
                <input
                  value={form.russian}
                  onChange={(e) => setForm((f) => ({ ...f, russian: e.target.value }))}
                  placeholder="Название на русском"
                />
              </label>
              <label className="field">
                <span>Узбекский</span>
                <input
                  value={form.uzbek}
                  onChange={(e) => setForm((f) => ({ ...f, uzbek: e.target.value }))}
                  placeholder="Oʻzbekcha"
                />
              </label>
              <label className="field">
                <span>Английский</span>
                <input
                  value={form.english}
                  onChange={(e) => setForm((f) => ({ ...f, english: e.target.value }))}
                  placeholder="English"
                />
              </label>
              <label className="field" style={{ gridColumn: '1 / -1' }}>
                <span>Примечание</span>
                <input
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Изох / описание"
                />
              </label>
              <div className="excel-row-form-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => setFormOpen(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn primary" disabled={busy}>
                  <Plus size={16} />
                  {busy ? 'Сохранение…' : 'Сохранить код'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function CodeDetail({ code }: { code: AccountCode }) {
  return (
    <>
      <div className="panel-head">
        <div>
          <div className="code-hero">
            <code>{code.code}</code>
          </div>
          <h2 style={{ marginTop: 10 }}>
            {displayName(code, 'ru') || displayName(code, 'en')}
          </h2>
        </div>
        <span className={`chip ${code.group === 'Прочий приход' ? 'method-cash' : 'method-card'}`}>
          {code.group}
        </span>
      </div>

      <div className="kv">
        {code.russian && (
          <div>
            <span>Русский</span>
            <strong>{code.russian}</strong>
          </div>
        )}
        {code.uzbek && (
          <div>
            <span>Узбекский</span>
            <strong>{code.uzbek}</strong>
          </div>
        )}
        {code.english && (
          <div>
            <span>Английский</span>
            <strong>{code.english}</strong>
          </div>
        )}
        <div>
          <span>Статус</span>
          <strong>{code.archived ? 'Архив — не использовать' : 'Активен'}</strong>
        </div>
      </div>

      {code.note && (
        <div className="settings-help" style={{ marginTop: 16 }}>
          <strong>Изох / примечание</strong>
          <p style={{ margin: '8px 0 0' }}>{code.note}</p>
        </div>
      )}
    </>
  );
}
