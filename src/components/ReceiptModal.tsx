import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Printer, X } from 'lucide-react';
import { HOSPITAL_NAME } from '../api/config';
import type { Transaction } from '../types';
import { formatMoney } from '../types';
import { paymentRu } from '../i18n/ru';

interface Props {
  tx: Transaction;
  onClose: () => void;
  onPrint: () => void;
}

export function ReceiptModal({ tx, onClose, onPrint }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-actions no-print">
          <button type="button" className="btn" onClick={onPrint}>
            <Printer size={16} />
            Печать
          </button>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div id="receipt-print" className="receipt">
          <div className="receipt-head">
            <strong>{HOSPITAL_NAME}</strong>
            <div>Квитанция об оплате</div>
          </div>
          <div className="receipt-meta">
            <div>
              <span>Чек</span>
              <strong>{tx.receiptNo}</strong>
            </div>
            <div>
              <span>Счёт</span>
              <strong>{tx.invoiceNo}</strong>
            </div>
            <div>
              <span>Дата</span>
              <strong>{format(new Date(tx.createdAt), 'dd MMM yyyy HH:mm', { locale: ru })}</strong>
            </div>
            <div>
              <span>Кассир</span>
              <strong>
                {tx.cashierName} ({tx.counterId})
              </strong>
            </div>
            {tx.accountCode && (
              <div>
                <span>Код счёта</span>
                <strong>{tx.accountCode}</strong>
              </div>
            )}
          </div>

          <div className="receipt-patient">
            <div>{tx.patient.name}</div>
            <div>
              {tx.patient.mrn}
              {tx.patient.phone ? ` · ${tx.patient.phone}` : ''}
            </div>
          </div>

          <table className="receipt-table">
            <thead>
              <tr>
                <th>Услуга</th>
                <th>Кол-во</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {tx.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.qty}</td>
                  <td>{formatMoney(item.qty * item.unitPrice - item.discount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="receipt-totals">
            <div>
              <span>Подытог</span>
              <span>{formatMoney(tx.subtotal)}</span>
            </div>
            {tx.discount > 0 && (
              <div>
                <span>Скидка</span>
                <span>-{formatMoney(tx.discount)}</span>
              </div>
            )}
            <div className="grand">
              <span>Итого</span>
              <span>{formatMoney(tx.total)}</span>
            </div>
            {tx.payments.map((p, i) => (
              <div key={i}>
                <span>
                  Оплачено ({paymentRu(p.method)}
                  {p.reference ? ` · ${p.reference}` : ''})
                </span>
                <span>{formatMoney(p.amount)}</span>
              </div>
            ))}
            {tx.change > 0 && (
              <div>
                <span>Сдача</span>
                <span>{formatMoney(tx.change)}</span>
              </div>
            )}
          </div>

          <p className="receipt-thanks">Спасибо, что выбрали {HOSPITAL_NAME}.</p>
        </div>
      </div>
    </div>
  );
}
