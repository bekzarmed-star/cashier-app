import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search, Users } from 'lucide-react';
import { employeesApi, type Employee } from '../api/employeesApi';
import { useCashierActor } from '../context/useCashierActor';
import { matchesBranch } from '../data/branches';

const PAGE_SIZE = 100;

export function WorkersPage() {
  const user = useCashierActor();
  const [items, setItems] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setOffset(0);
  }, [user?.branchCode]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        // Fetch a wider window then filter by cashier branch client-side
        const page = await employeesApi.list({
          limit: 500,
          offset: 0,
          q: search,
        });
        if (!alive) return;
        const branchCode = user?.branchCode || '';
        const filtered = branchCode
          ? page.items.filter((e) => matchesBranch(branchCode, e.branchCode, e.branchName))
          : page.items;
        setTotal(filtered.length);
        setItems(filtered.slice(offset, offset + PAGE_SIZE));
      } catch (err) {
        if (!alive) return;
        setItems([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : 'Не удалось загрузить сотрудников');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [offset, search, user?.branchCode, refreshKey]);

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;
  const branchHint = user?.branchLabel ? ` · филиал ${user.branchLabel}` : '';

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Сотрудники</h1>
          <p className="muted">
            Список из внешней REST API{branchHint} · {loading ? '…' : `всего ${total}`}
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={loading}
          onClick={() => setRefreshKey((k) => k + 1)}
        >
          <RefreshCw size={16} />
          Обновить
        </button>
      </header>

      <section className="stat-grid" style={{ marginBottom: 16, gridTemplateColumns: '1fr' }}>
        <div className="stat accent">
          <div className="stat-label">
            <Users size={18} />
            Сотрудников {user?.branchLabel ? `(${user.branchLabel})` : 'во внешней системе'}
          </div>
          <div className="stat-value">{loading && total === 0 ? '…' : total}</div>
        </div>
      </section>

      <section className="panel">
        <div className="search-bar">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по ФИО…"
          />
        </div>

        {error && <div className="alert error">{error}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>ФИО</th>
                <th>Код филиала</th>
                <th>Филиал</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} className="empty">
                    Загрузка сотрудников…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    Сотрудники не найдены для этого филиала.
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <code>{e.id}</code>
                    </td>
                    <td>
                      <div className="cell-title">{e.fullName}</div>
                    </td>
                    <td>
                      <code>{e.branchCode}</code>
                    </td>
                    <td>{e.branchName || '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="workers-pager">
          <span className="muted">
            {loading ? '…' : `Показано ${from}–${to} из ${total}`}
          </span>
          <div className="excel-actions">
            <button
              type="button"
              className="btn"
              disabled={!canPrev || loading}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            >
              <ChevronLeft size={16} />
              Назад
            </button>
            <button
              type="button"
              className="btn"
              disabled={!canNext || loading}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
            >
              Далее
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
