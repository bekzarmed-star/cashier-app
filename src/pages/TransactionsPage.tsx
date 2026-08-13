import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Search, Eye } from 'lucide-react';
import { cashierApi } from '../api/cashierApi';
import type { Transaction } from '../types';
import { formatMoney } from '../types';
import { ReceiptModal } from '../components/ReceiptModal';
import { paymentRu } from '../i18n/ru';

export function TransactionsPage() {
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Transaction | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const list = await cashierApi.getTransactions({ query });
          if (alive) setTxs(list);
        } finally {
          if (alive) setLoading(false);
        }
      })();
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Транзакции</h1>
          <p className="muted">Чеки, собранные на этой кассе</p>
        </div>
      </header>

      <section className="panel">
        <div className="search-bar">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по чеку, счёту, пациенту…"
          />
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Чек</th>
                <th>Пациент</th>
                <th>Счёт</th>
                <th>Дата</th>
                <th>Способы</th>
                <th>Код</th>
                <th className="num">Итого</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="empty">
                    Загрузка…
                  </td>
                </tr>
              )}
              {!loading && txs.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">
                    Транзакции не найдены.
                  </td>
                </tr>
              )}
              {txs.map((t) => (
                <tr key={t.id}>
                  <td>
                    <code>{t.receiptNo}</code>
                  </td>
                  <td>
                    <div className="cell-title">{t.patient.name}</div>
                    <div className="cell-sub">{t.patient.mrn}</div>
                  </td>
                  <td>
                    <code>{t.invoiceNo}</code>
                  </td>
                  <td>{format(new Date(t.createdAt), 'dd MMM HH:mm', { locale: ru })}</td>
                  <td>
                    <div className="chips">
                      {t.payments.map((p, i) => (
                        <span key={i} className={`chip method-${p.method}`}>
                          {paymentRu(p.method)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{t.accountCode ? <code>{t.accountCode}</code> : '—'}</td>
                  <td className="num strong">{formatMoney(t.total)}</td>
                  <td>
                    <button type="button" className="icon-btn" onClick={() => setSelected(t)}>
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <ReceiptModal
          tx={selected}
          onClose={() => setSelected(null)}
          onPrint={() => window.print()}
        />
      )}
    </div>
  );
}
