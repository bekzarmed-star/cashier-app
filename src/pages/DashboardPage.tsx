import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote,
  CreditCard,
  ArrowLeftRight,
  Shield,
  FileClock,
  Receipt,
  FileCheck2,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { cashierApi } from '../api/cashierApi';
import { useCashierActor } from '../context/useCashierActor';
import type { DashboardStats, Transaction } from '../types';
import { formatMoney } from '../types';
import { paymentRu } from '../i18n/ru';

export function DashboardPage() {
  const user = useCashierActor();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [s, txs] = await Promise.all([
          cashierApi.getDashboardStats(),
          cashierApi.getTransactions(),
        ]);
        if (!alive) return;
        setStats(s);
        setRecent(txs.slice(0, 6));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Добрый день, {user?.name?.split(' ')[0]}</h1>
          <p className="muted">
            {format(new Date(), 'EEEE, d MMMM yyyy', { locale: ru })} · Касса {user?.counterId}
          </p>
        </div>
        <Link to="/erp-invoices" className="btn primary">
          <FileCheck2 size={18} />
          Счета ERP
        </Link>
      </header>

      <section className="stat-grid">
        <Stat
          label="Сборы за сегодня"
          value={loading ? '—' : formatMoney(stats?.todayCollections ?? 0)}
          tone="accent"
        />
        <Stat
          label="Транзакции"
          value={loading ? '—' : String(stats?.todayTransactions ?? 0)}
          icon={<Receipt size={18} />}
        />
        <Stat
          label="Ожидающие счета"
          value={loading ? '—' : String(stats?.pendingBills ?? 0)}
          icon={<FileClock size={18} />}
        />
      </section>

      <section className="method-grid">
        <MethodCard icon={<Banknote size={18} />} label="Наличные" amount={stats?.cashTotal ?? 0} />
        <MethodCard icon={<CreditCard size={18} />} label="Карта" amount={stats?.cardTotal ?? 0} />
        <MethodCard
          icon={<ArrowLeftRight size={18} />}
          label="Перевод"
          amount={stats?.transferTotal ?? 0}
        />
        <MethodCard
          icon={<Shield size={18} />}
          label="Страховка"
          amount={stats?.insuranceTotal ?? 0}
        />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Последние транзакции</h2>
          <Link to="/transactions" className="text-link">
            Все
          </Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Чек</th>
                <th>Пациент</th>
                <th>Время</th>
                <th>Способ</th>
                <th className="num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    Сегодня транзакций ещё нет.
                  </td>
                </tr>
              )}
              {recent.map((t) => (
                <tr key={t.id}>
                  <td>
                    <code>{t.receiptNo}</code>
                  </td>
                  <td>
                    <div className="cell-title">{t.patient.name}</div>
                    <div className="cell-sub">{t.patient.mrn}</div>
                  </td>
                  <td>{format(new Date(t.createdAt), 'HH:mm')}</td>
                  <td>
                    <div className="chips">
                      {t.payments.map((p, i) => (
                        <span key={i} className={`chip method-${p.method}`}>
                          {paymentRu(p.method)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="num strong">{formatMoney(t.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: 'accent';
  icon?: React.ReactNode;
}) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function MethodCard({
  icon,
  label,
  amount,
}: {
  icon: React.ReactNode;
  label: string;
  amount: number;
}) {
  return (
    <div className="method-card">
      <div className="method-icon">{icon}</div>
      <div>
        <div className="method-label">{label}</div>
        <div className="method-amount">{formatMoney(amount)}</div>
      </div>
    </div>
  );
}
