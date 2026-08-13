import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  Printer,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { erpApi, type ErpInvoice, type ErpInvoiceTab } from '../api/erpApi';
import { employeesApi, type Employee } from '../api/employeesApi';
import { useCashierActor } from '../context/useCashierActor';
import { HOSPITAL_NAME } from '../api/config';
import { formatMoney } from '../types';
import { saveExcelAutofill } from '../utils/excelAutofill';
import { getAccountByCode, searchAccountCodes } from '../data/accountCodes';
import { displayName, isParentCode } from '../types/accountCode';
import { BRANCHES, branchLabel, matchesBranch } from '../data/branches';

const PAGE_SIZE = 40;

function moneyLabel(amount: number, currency: string) {
  if (String(currency).toLowerCase() === 'dollar' || currency === 'USD') {
    return `$${Number(amount || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
  }
  return formatMoney(amount);
}

function formatSignDate(value: string | null | undefined) {
  if (!value) return '—';
  // ERP often sends dd.MM.yyyy
  if (/^\d{2}\.\d{2}\.\d{4}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return format(d, 'dd.MM.yyyy');
}

/** Cashier accept day: stored acceptance, else today (print / accept same day). */
function cashierAcceptDate(inv: ErpInvoice | null | undefined): Date {
  const raw = inv?.localAcceptance?.acceptedAt || inv?.cashierReceived?.receivedAt || '';
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function isImageSignature(sig: string) {
  return (
    sig.startsWith('data:image') ||
    sig.startsWith('http://') ||
    sig.startsWith('https://') ||
    sig.startsWith('/')
  );
}

export function ErpInvoicesPage() {
  const user = useCashierActor();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ErpInvoiceTab>('awaiting');
  const [items, setItems] = useState<ErpInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState(() => user?.branchCode || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [selected, setSelected] = useState<ErpInvoice | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [note, setNote] = useState('');
  const [initiatorEdit, setInitiatorEdit] = useState('');
  const [recipientOpen, setRecipientOpen] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [accountCode, setAccountCode] = useState('');
  const [codeQuery, setCodeQuery] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);

  // Keep invoice list locked to the cashier's selected branch
  useEffect(() => {
    const code = user?.branchCode || '';
    setBranch(code);
    setOffset(0);
  }, [user?.branchCode]);

  const codeMatches = useMemo(() => {
    const list = searchAccountCodes(codeQuery || accountCode)
      .filter((c) => !isParentCode(c.code))
      .slice(0, 40);
    return list;
  }, [codeQuery, accountCode]);

  const selectedAccount = accountCode ? getAccountByCode(accountCode) : undefined;

  // Load employees for Получатель dropdown (branch-filtered)
  useEffect(() => {
    let alive = true;
    (async () => {
      setEmployeesLoading(true);
      try {
        const page = await employeesApi.list({ limit: 500, offset: 0 });
        if (!alive) return;
        const branchCode = user?.branchCode || '';
        const list = branchCode
          ? page.items.filter((e) => matchesBranch(branchCode, e.branchCode, e.branchName))
          : page.items;
        setEmployees(list);
      } catch {
        if (alive) setEmployees([]);
      } finally {
        if (alive) setEmployeesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.branchCode]);

  const recipientMatches = useMemo(() => {
    const q = initiatorEdit.trim().toLowerCase();
    const ranked = !q
      ? employees
      : [
          ...employees.filter((e) => e.fullName.toLowerCase().startsWith(q)),
          ...employees.filter((e) => {
            const name = e.fullName.toLowerCase();
            return !name.startsWith(q) && name.includes(q);
          }),
        ];
    // Deduplicate by name
    const seen = new Set<string>();
    const unique: Employee[] = [];
    for (const e of ranked) {
      const key = e.fullName.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(e);
      if (unique.length >= 40) break;
    }
    return unique;
  }, [employees, initiatorEdit]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const page = await erpApi.listInvoices({
        tab,
        q: search,
        branch,
        limit: PAGE_SIZE,
        offset,
      });
      setItems(page.items);
      setTotal(page.total);
    } catch (err) {
      setItems([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : 'Не удалось загрузить счета ERP');
    } finally {
      setLoading(false);
    }
  }, [tab, search, branch, offset]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openDetail(inv: ErpInvoice) {
    setNote('');
    setHint('');
    setInitiatorEdit(inv.initiator || '');
    setRecipientOpen(false);
    setAccountCode('');
    setCodeQuery('');
    setCodeOpen(false);
    setSelected(inv);
    try {
      const full = await erpApi.getInvoice(inv.id);
      setSelected(full);
      setInitiatorEdit(full.initiator || '');
    } catch {
      /* keep list row */
    }
  }

  function printSelected() {
    document.body.classList.add('printing-document');
    const cleanup = () => {
      document.body.classList.remove('printing-document');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // Fallback if afterprint is delayed/missing
    window.setTimeout(cleanup, 2000);
    window.print();
  }

  async function acceptSelected() {
    if (!selected || !user) return;
    const code = accountCode.trim().toUpperCase();
    if (!code || !getAccountByCode(code)) {
      setError('Выберите код счёта по виду оплаты.');
      return;
    }
    if (!confirm(`Дал деньги по счёту № ${selected.regNo} на сумму ${moneyLabel(selected.amount, selected.currency)}?`)) {
      return;
    }
    setAccepting(true);
    setError('');
    setHint('');
    try {
      const initiatorName = initiatorEdit.trim() || selected.initiator;
      const account = getAccountByCode(code);
      const noteParts = [];
      if (initiatorName && initiatorName !== selected.initiator) {
        noteParts.push(`Инициатор (касса): ${initiatorName}`);
      }
      noteParts.push(`Код ${code}`);
      if (note.trim()) noteParts.push(note.trim());
      if (selected.regNo) noteParts.push(`Рег. № ${selected.regNo}`);

      const result = await erpApi.acceptInvoice(selected.id, {
        cashier: { id: user.id, name: user.name },
        note: noteParts.join('\n'),
      });

      const payForm =
        selected.payType === 'Cash'
          ? 'Наличные'
          : selected.payType === 'Bank'
            ? 'Банк'
            : selected.payType === 'Both'
              ? 'Касса / Банк'
              : selected.payTypeRu || selected.payType || 'Наличные';

      const titleFromCode =
        (account && (displayName(account, 'ru') || displayName(account, 'uz'))) || '';
      const invoiceTitle =
        (selected.title || '').trim() ||
        (selected.explanation || '').trim() ||
        titleFromCode ||
        `Счёт ERP ${selected.regNo || selected.id}`;

      // Excel «Дата» = day cashier accepted («Дал деньги»), not invoice regDate.
      // Invoice generate date stays on the invoice header / print top.
      const excelDate = format(new Date(), 'yyyy-MM-dd');
      const rawRegDate = (selected.regDate || '').trim();
      let invoiceGenDate = '';
      if (/^\d{4}-\d{2}-\d{2}/.test(rawRegDate)) {
        invoiceGenDate = rawRegDate.slice(0, 10);
      } else if (/^\d{2}\.\d{2}\.\d{4}/.test(rawRegDate)) {
        const [dd, mm, yyyy] = rawRegDate.slice(0, 10).split('.');
        invoiceGenDate = `${yyyy}-${mm}-${dd}`;
      } else if (rawRegDate) {
        invoiceGenDate = rawRegDate;
      }

      const excelNote = [
        selected.regNo ? `Рег. № ${selected.regNo}` : '',
        invoiceGenDate ? `Счёт от ${invoiceGenDate}` : '',
        `Код ${code}${titleFromCode ? ` — ${titleFromCode}` : ''}`,
        selected.explanation && selected.explanation !== selected.title
          ? selected.explanation.trim()
          : '',
        note.trim(),
        initiatorName && initiatorName !== selected.initiator
          ? `Инициатор (касса): ${initiatorName}`
          : '',
      ]
        .filter(Boolean)
        .join(' · ');

      saveExcelAutofill({
        date: excelDate,
        initiator: initiatorName || '',
        title: invoiceTitle,
        amount: selected.amount || 0,
        status: selected.statusRu || selected.status || 'Согласовано',
        branch: selected.branch || '',
        payForm,
        code,
        note: excelNote || `ERP ${selected.regNo}`,
        regNo: selected.regNo || '',
        erpId: selected.id,
      });

      if (result.erpPush?.ok) {
        setHint('Дал деньги. Открываем месячный Excel…');
      } else if (result.erpPush?.skipped) {
        setHint('Дал деньги (ERP не обновлён). Открываем месячный Excel…');
      } else {
        setHint('Дал деньги. Открываем месячный Excel…');
      }
      setSelected(null);
      navigate('/excel', { state: { fromErpCashOut: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка: не удалось отметить «Дал деньги»');
    } finally {
      setAccepting(false);
    }
  }

  async function retryPushSelected() {
    if (!selected || !user) return;
    setAccepting(true);
    setError('');
    setHint('');
    try {
      await erpApi.pushInvoiceToErp(selected.id, { id: user.id, name: user.name });
      setHint('Метка кассы отправлена в ERP.');
      const full = await erpApi.getInvoice(selected.id);
      setSelected(full);
      setInitiatorEdit(full.initiator || initiatorEdit);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки в ERP');
    } finally {
      setAccepting(false);
    }
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const isApproved =
    selected &&
    (selected.status === 'Approved' ||
      selected.status === 'Archived' ||
      selected.status === 'Sent to Feeds' ||
      /согласован/i.test(selected.statusRu || ''));
  const approvers = selected?.approvers || [];
  const leaders = approvers.slice(0, 3);
  const leader4 = approvers[3];
  const displayInitiator = initiatorEdit.trim() || selected?.initiator || '—';
  const acceptDay = cashierAcceptDate(selected);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Счета ERP</h1>
          <p className="muted">
            Приём согласованных счетов из ERP
            {user?.branchLabel ? ` · филиал ${user.branchLabel}` : ''} — как «Получено кассой» в BMS
          </p>
        </div>
        <button type="button" className="btn" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw size={16} />
          Обновить
        </button>
      </header>

      {(error || hint) && (
        <div className={`alert ${error ? 'error' : ''}`} style={{ marginBottom: 12 }}>
          {error || hint}
        </div>
      )}

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="excel-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              ['awaiting', 'Ожидают кассу'],
              ['accepted', 'Дал деньги'],
              ['all', 'Все (касса)'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn ${tab === id ? 'primary' : ''}`}
              onClick={() => {
                setTab(id);
                setOffset(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="search-bar" style={{ marginTop: 12 }}>
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: рег. №, получатель, наименование…"
          />
        </div>

        <div className="admin-form-grid" style={{ marginTop: 12 }}>
          <label className="field">
            <span>Филиал</span>
            <select value={branch} disabled aria-label="Филиал кассы">
              {branch ? (
                <option value={branch}>{branchLabel(branch) || branch}</option>
              ) : (
                <option value="">Все филиалы</option>
              )}
              {BRANCHES.filter((b) => b.code !== branch).map((b) => (
                <option key={b.code} value={b.code}>
                  {b.label}
                </option>
              ))}
            </select>
            <span className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
              Смена филиала — в боковой панели или при входе
            </span>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>
            <FileCheck2 size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            {tab === 'awaiting' && 'Очередь кассы'}
            {tab === 'accepted' && 'Дал деньги'}
            {tab === 'all' && 'Согласованные (касса / оба)'}
            {' · '}
            {loading ? '…' : total}
          </h2>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Рег. №</th>
                <th>Дата</th>
                <th>Получатель</th>
                <th>Наименование</th>
                <th>Филиал</th>
                <th>Оплата</th>
                <th className="num">Сумма</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="empty">
                    Загрузка счетов из ERP…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty">
                    {tab === 'awaiting'
                      ? 'Нет счетов, ожидающих приёма кассой.'
                      : 'Счета не найдены.'}
                  </td>
                </tr>
              )}
              {items.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <code>{inv.regNo || '—'}</code>
                  </td>
                  <td>{inv.regDate || '—'}</td>
                  <td>
                    <div className="cell-title">{inv.initiator || '—'}</div>
                    <div className="cell-sub">{inv.initiatorDept || ''}</div>
                  </td>
                  <td>
                    <div className="cell-title" style={{ maxWidth: 280 }}>
                      {inv.title || '—'}
                    </div>
                  </td>
                  <td>{inv.branch || '—'}</td>
                  <td>
                    <span
                      className={`chip ${
                        inv.payType === 'Cash' || inv.payType === 'Both'
                          ? 'method-cash'
                          : 'method-card'
                      }`}
                    >
                      {inv.payTypeRu || inv.payType}
                    </span>
                  </td>
                  <td className="num strong">{moneyLabel(inv.amount, inv.currency)}</td>
                  <td>
                    {inv.localAccepted || inv.cashierReceived?.received ? (
                      <span className="chip method-cash">Дал деньги</span>
                    ) : (
                      <span className="chip">{inv.statusRu || inv.status}</span>
                    )}
                  </td>
                  <td>
                    <button type="button" className="btn" onClick={() => void openDetail(inv)}>
                      Открыть
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE && (
          <div className="excel-actions" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            <span className="muted">
              {from}–{to} из {total}
            </span>
            <div className="excel-actions">
              <button
                type="button"
                className="btn"
                disabled={offset <= 0 || loading}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                className="btn"
                disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </section>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div
            className="modal erp-invoice-modal"
            style={{ width: 'min(720px, 100%)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-actions no-print">
              <button type="button" className="btn" onClick={printSelected}>
                <Printer size={16} />
                Печать
              </button>
              <button type="button" className="icon-btn" onClick={() => setSelected(null)}>
                <X size={18} />
              </button>
            </div>

            <div id="erp-invoice-print" className="erp-invoice-print">
              <div className="drawer-hero">
                <FileCheck2 size={28} className="no-print" />
                <div className="erp-print-brand">{HOSPITAL_NAME}</div>
                <h2>Счёт № {selected.regNo}</h2>
                <p className="muted">
                  Счёт от{' '}
                  {selected.regDate
                    ? format(new Date(selected.regDate), 'd MMMM yyyy', { locale: ru })
                    : '—'}{' '}
                  · {selected.branch}
                </p>
                <p className="muted erp-accept-date-line">
                  Принято кассой:{' '}
                  <strong>{format(acceptDay, 'd MMMM yyyy', { locale: ru })}</strong>
                </p>
                <p className="strong" style={{ fontSize: '1.35rem', marginTop: 8 }}>
                  {moneyLabel(selected.amount, selected.currency)}
                </p>
                {selected.sumInWords && (
                  <p className="muted" style={{ fontSize: '0.85rem' }}>
                    {selected.sumInWords}
                  </p>
                )}
              </div>

              <div className="kv">
                <div>
                  <span>Дата счёта</span>
                  <strong>
                    {selected.regDate
                      ? format(new Date(selected.regDate), 'dd.MM.yyyy', { locale: ru })
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span>Дата принятия кассой</span>
                  <strong>{format(acceptDay, 'dd.MM.yyyy')}</strong>
                </div>
                <div>
                  <span>Статус</span>
                  <strong>{selected.statusRu || selected.status}</strong>
                </div>
                <div>
                  <span>Форма оплаты</span>
                  <strong>{selected.payTypeRu || selected.payType}</strong>
                </div>
                <div className="erp-initiator-row">
                  <span>Получатель</span>
                  <div className="erp-initiator-edit">
                    <div className="erp-recipient-pick no-print">
                      <input
                        value={initiatorEdit}
                        onChange={(e) => {
                          setInitiatorEdit(e.target.value);
                          setRecipientOpen(true);
                        }}
                        onFocus={() => setRecipientOpen(true)}
                        onBlur={() => {
                          // Allow click on dropdown option
                          window.setTimeout(() => setRecipientOpen(false), 180);
                        }}
                        placeholder={
                          selected.initiator
                            ? `Из счёта: ${selected.initiator}`
                            : 'ФИО получателя или выбор сотрудника'
                        }
                        autoComplete="off"
                      />
                      {recipientOpen && (
                        <div className="erp-code-dropdown erp-recipient-dropdown">
                          {selected.initiator &&
                            selected.initiator.trim().toLowerCase() !==
                              initiatorEdit.trim().toLowerCase() && (
                              <button
                                type="button"
                                className="erp-code-option"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setInitiatorEdit(selected.initiator);
                                  setRecipientOpen(false);
                                }}
                              >
                                <code>счёт</code>
                                <span>{selected.initiator}</span>
                              </button>
                            )}
                          {employeesLoading && (
                            <div className="erp-recipient-empty muted">Загрузка сотрудников…</div>
                          )}
                          {!employeesLoading && recipientMatches.length === 0 && (
                            <div className="erp-recipient-empty muted">
                              Сотрудники не найдены — можно ввести ФИО вручную
                            </div>
                          )}
                          {recipientMatches.map((e) => (
                            <button
                              key={String(e.id)}
                              type="button"
                              className="erp-code-option"
                              onMouseDown={(e2) => e2.preventDefault()}
                              onClick={() => {
                                setInitiatorEdit(e.fullName);
                                setRecipientOpen(false);
                              }}
                            >
                              <code>{e.branchCode || '—'}</code>
                              <span>{e.fullName}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <strong className="print-only">{displayInitiator}</strong>
                    <span className="muted no-print" style={{ fontSize: '0.78rem' }}>
                      По умолчанию — имя из счёта. Если забрал другой человек — выберите сотрудника
                      из списка.
                    </span>
                  </div>
                </div>
                <div>
                  <span>Отдел</span>
                  <strong>{selected.initiatorDept || '—'}</strong>
                </div>
                <div>
                  <span>Контрагент</span>
                  <strong>{selected.recipient || '—'}</strong>
                </div>
                <div>
                  <span>Наименование</span>
                  <strong style={{ textAlign: 'right', maxWidth: '60%' }}>{selected.title}</strong>
                </div>
                <div>
                  <span>Код</span>
                  <strong>
                    {accountCode
                      ? `${accountCode}${selectedAccount ? ` — ${displayName(selectedAccount, 'ru')}` : ''}`
                      : '— выберите ниже'}
                  </strong>
                </div>
              </div>

              {selected.paymentBasis?.filter((line) => String(line.name || '').trim()).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Основание оплаты</h3>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Наименование</th>
                          <th className="num">Кол-во</th>
                          <th className="num">Цена</th>
                          <th className="num">Сумма</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.paymentBasis
                          .filter((line) => String(line.name || '').trim())
                          .map((line, i) => (
                          <tr key={i}>
                            <td>{line.name}</td>
                            <td className="num">
                              {line.qty}
                              {line.unit ? ` ${line.unit}` : ''}
                            </td>
                            <td className="num">{moneyLabel(line.price, selected.currency)}</td>
                            <td className="num strong">{moneyLabel(line.total, selected.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(isApproved || leaders.some((a) => a.isApproved) || leader4?.isApproved) && (
                <div className="erp-sign-block">
                  <h3>
                    Согласование руководителей
                    {isApproved ? ' · Согласовано' : ''}
                  </h3>
                  <div className="erp-sign-grid">
                    {leaders.map((a) => (
                      <div
                        key={a.label}
                        className={`erp-sign-card ${a.isApproved ? 'signed' : ''} ${a.isRejected ? 'rejected' : ''}`}
                      >
                        <div className="erp-sign-label">
                          {a.label}
                          {a.isApproved && <span className="chip method-cash">подписано</span>}
                          {a.isRejected && <span className="chip method-card">отклонено</span>}
                          {!a.isApproved && !a.isRejected && (
                            <span className="chip">ожидает</span>
                          )}
                        </div>
                        <div className="erp-sign-role">{a.role || 'Руководитель'}</div>
                        <div className="erp-sign-name">
                          {a.isApproved ? a.approvedByName || a.name : a.name || '—'}
                        </div>
                        <div className="erp-sign-date">
                          Дата: {a.isApproved ? formatSignDate(a.approvedAt) : '—'}
                        </div>
                        <div className="erp-sign-pad">
                          {a.signature && isImageSignature(a.signature) ? (
                            <img src={a.signature} alt={`Подпись ${a.label}`} />
                          ) : a.isApproved ? (
                            <div className="erp-sign-stamp">Подпись / {formatSignDate(a.approvedAt)}</div>
                          ) : (
                            <div className="erp-sign-empty">Нет подписи</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {leader4 && (
                    <div
                      className={`erp-sign-card erp-sign-l4 ${leader4.isApproved ? 'signed' : ''} ${leader4.isRejected ? 'rejected' : ''}`}
                    >
                      <div className="erp-sign-label">
                        L4
                        {leader4.isApproved && <span className="chip method-cash">подписано</span>}
                        {leader4.isRejected && <span className="chip method-card">отклонено</span>}
                        {!leader4.isApproved && !leader4.isRejected && (
                          <span className="chip">ожидает</span>
                        )}
                      </div>
                      <div className="erp-sign-role">{leader4.role || 'Руководитель / директор'}</div>
                      <div className="erp-sign-name">
                        {leader4.isApproved
                          ? leader4.approvedByName || leader4.name
                          : leader4.name || '—'}
                      </div>
                      <div className="erp-sign-date">
                        Дата: {leader4.isApproved ? formatSignDate(leader4.approvedAt) : '—'}
                      </div>
                      <div className="erp-sign-pad">
                        {leader4.signature && isImageSignature(leader4.signature) ? (
                          <img src={leader4.signature} alt="Подпись L4" />
                        ) : leader4.isApproved ? (
                          <div className="erp-sign-stamp">
                            Подпись L4 / {formatSignDate(leader4.approvedAt)}
                          </div>
                        ) : (
                          <div className="erp-sign-empty">Нет подписи L4</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="erp-sign-blocks-row">
                <div className="erp-sign-block erp-initiator-sign-block">
                  <h3>Подпись получателя</h3>
                  <div className="erp-initiator-sign-card">
                    <div className="erp-initiator-sign-meta">
                      <div>
                        <span className="muted">ФИО</span>
                        <strong>{displayInitiator}</strong>
                      </div>
                      <div>
                        <span className="muted">Отдел</span>
                        <strong>{selected.initiatorDept || '—'}</strong>
                      </div>
                      <div>
                        <span className="muted">Дата подписания</span>
                        <strong className="erp-hand-date-line">____________</strong>
                      </div>
                    </div>
                    <div className="erp-initiator-sign-line">
                      {selected.initiatorSignature && isImageSignature(selected.initiatorSignature) ? (
                        <img
                          src={selected.initiatorSignature}
                          alt="Подпись получателя"
                          className="erp-initiator-sig-img"
                        />
                      ) : (
                        <div className="erp-hand-sign-area">
                          <span className="muted">Место для подписи получателя</span>
                        </div>
                      )}
                    </div>
                    <div className="erp-initiator-sign-caption">
                      Подпись получателя _______________________________ / {displayInitiator}
                    </div>
                  </div>
                </div>

                <div className="erp-sign-block erp-cashier-sign-block">
                  <h3>Подпись кассира</h3>
                  <div className="erp-initiator-sign-card">
                    <div className="erp-initiator-sign-meta">
                      <div>
                        <span className="muted">ФИО кассира</span>
                        <strong>
                          {selected.localAcceptance?.cashierName ||
                            selected.cashierReceived?.receivedBy ||
                            user?.name ||
                            '—'}
                        </strong>
                      </div>
                      <div>
                        <span className="muted">Касса</span>
                        <strong>{user?.counterId || '—'}</strong>
                      </div>
                      <div>
                        <span className="muted">Дата подписания</span>
                        <strong className="erp-hand-date-line">
                          {format(acceptDay, 'dd.MM.yyyy')}
                        </strong>
                      </div>
                    </div>
                    <div className="erp-initiator-sign-line">
                      <div className="erp-hand-sign-area">
                        <span className="muted">Место для подписи кассира</span>
                      </div>
                    </div>
                    <div className="erp-initiator-sign-caption">
                      Подпись кассира _______________________________ /{' '}
                      {selected.localAcceptance?.cashierName ||
                        selected.cashierReceived?.receivedBy ||
                        user?.name ||
                        '_______________'}
                    </div>
                  </div>
                </div>
              </div>

              {(selected.localAccepted || selected.cashierReceived?.received) && (
                <div className="variance ok" style={{ marginTop: 14 }}>
                  Дал деньги:{' '}
                  {selected.localAcceptance?.cashierName ||
                    selected.cashierReceived.receivedBy ||
                    '—'}
                  {` · ${format(acceptDay, 'dd.MM.yyyy HH:mm')}`}
                </div>
              )}
              {!selected.localAccepted && !selected.cashierReceived?.received && (
                <div className="variance ok print-only" style={{ marginTop: 14 }}>
                  Дата принятия кассой: {format(acceptDay, 'dd.MM.yyyy')}
                </div>
              )}
            </div>

            {selected.localAcceptance && !selected.localAcceptance.erpPushed && (
              <div className="no-print" style={{ marginTop: 8 }}>
                <p className="muted" style={{ marginBottom: 8 }}>
                  В ERP метка кассы ещё не записана
                  {selected.localAcceptance.erpPushError
                    ? `: ${selected.localAcceptance.erpPushError}`
                    : '.'}
                </p>
                <button
                  type="button"
                  className="btn"
                  disabled={accepting}
                  onClick={() => void retryPushSelected()}
                >
                  Отправить метку кассы в ERP
                </button>
              </div>
            )}

            {selected.awaitAccept !== false &&
              selected.needsCashier &&
              !selected.localAccepted &&
              !selected.cashierReceived?.received && (
                <div className="no-print" style={{ marginTop: 16 }}>
                  <label className="field">
                    <span>Код счёта (обязательно)</span>
                    <div style={{ position: 'relative' }}>
                      <input
                        value={codeQuery || accountCode}
                        onChange={(e) => {
                          setCodeQuery(e.target.value);
                          setAccountCode('');
                          setCodeOpen(true);
                        }}
                        onFocus={() => setCodeOpen(true)}
                        placeholder="Поиск: A1, зарплата, командировка…"
                        autoComplete="off"
                      />
                      {codeOpen && codeMatches.length > 0 && (
                        <div className="erp-code-dropdown">
                          {codeMatches.map((c) => (
                            <button
                              key={c.code}
                              type="button"
                              className="erp-code-option"
                              onClick={() => {
                                setAccountCode(c.code);
                                setCodeQuery(
                                  `${c.code} — ${displayName(c, 'ru') || displayName(c, 'uz')}`,
                                );
                                setCodeOpen(false);
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
                    </div>
                  </label>
                  {selectedAccount && (
                    <p className="muted" style={{ marginTop: 6, fontSize: '0.85rem' }}>
                      Выбран: <code>{selectedAccount.code}</code> —{' '}
                      {displayName(selectedAccount, 'ru') || displayName(selectedAccount, 'uz')}
                      {selectedAccount.group ? ` · ${selectedAccount.group}` : ''}
                    </p>
                  )}
                  <label className="field" style={{ marginTop: 10 }}>
                    <span>Примечание (необязательно)</span>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Комментарий кассира"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn primary full"
                    style={{ marginTop: 12 }}
                    disabled={accepting}
                    onClick={() => void acceptSelected()}
                  >
                    <CheckCircle2 size={18} />
                    {accepting ? 'Сохранение…' : 'Дал деньги (Получено кассой)'}
                  </button>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
