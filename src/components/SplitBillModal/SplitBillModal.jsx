import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import styles from './SplitBillModal.module.css';

// Открывается только после явного выбора гостя "За весь стол" — до этого
// момента гость не видит чужие корзины (get_table_bill не вызывается больше
// нигде). Показывает корзину каждого места за столом, даёт выбрать, за кого
// гость готов заплатить (например, только за свою семью в большой компании),
// и ВОЗВРАЩАЕТ выбранные места через onConfirm. Саму оплату (и пометку paid)
// делает уже поток чек -> СБП -> подтверждение, а не эта модалка — чтобы места
// не помечались оплаченными до реальной оплаты.
const SplitBillModal = ({ isOpen, onClose, restaurantId, tableNumber, mySeatNumber, onConfirm }) => {
  const [loading, setLoading] = useState(false);
  const [seats, setSeats] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      setErrorText('');

      const { data, error } = await supabase.rpc('get_table_bill', {
        p_restaurant_id: restaurantId,
        p_table_number: String(tableNumber),
      });

      if (cancelled) return;

      if (error) {
        console.error('Ошибка загрузки счёта по местам:', error);
        setErrorText('Не удалось загрузить счёт. Попробуйте ещё раз.');
        setLoading(false);
        return;
      }

      const bySeat = new Map();
      (data || []).forEach(row => {
        if (!bySeat.has(row.seat_number)) {
          bySeat.set(row.seat_number, {
            seatNumber: row.seat_number,
            isPaid: row.is_paid,
            items: [],
            subtotal: 0,
          });
        }
        const seat = bySeat.get(row.seat_number);
        seat.items.push(row);
        seat.subtotal += Number(row.line_total || 0);
      });

      const seatList = [...bySeat.values()].sort((a, b) => a.seatNumber - b.seatNumber);
      setSeats(seatList);

      // По умолчанию отмечено только своё место (если оно ещё не оплачено) —
      // случайное нажатие не должно платить за чужой стол.
      const mine = seatList.find(s => s.seatNumber === mySeatNumber);
      setSelected(mine && !mine.isPaid ? new Set([mySeatNumber]) : new Set());
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [isOpen, restaurantId, tableNumber, mySeatNumber]);

  const toggleSeat = (seatNumber) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(seatNumber)) next.delete(seatNumber);
      else next.add(seatNumber);
      return next;
    });
  };

  const selectedTotal = seats
    .filter(s => selected.has(s.seatNumber))
    .reduce((sum, s) => sum + s.subtotal, 0);

  const handleConfirm = () => {
    if (selected.size === 0) return;
    // Раньше здесь сразу шёл pay_table_seats. Теперь модалка только ВЫБИРАЕТ
    // места и отдаёт их наверх — оплата (и пометка paid) идёт дальше в потоке
    // чек -> СБП -> подтверждение, чтобы ничего не закрывалось до денег.
    onConfirm([...selected]);
  };

  if (!isOpen) return null;

  const hasUnpaidSeats = seats.some(s => !s.isPaid);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Счёт за стол</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.seatList}>
          {loading && <div className={styles.infoText}>Загрузка...</div>}

          {!loading && errorText && <div className={styles.infoText}>{errorText}</div>}

          {!loading && !errorText && seats.length === 0 && (
            <div className={styles.infoText}>Счёт за этим столом уже оплачен.</div>
          )}

          {!loading && !errorText && seats.length > 0 && !hasUnpaidSeats && (
            <div className={styles.infoText}>Все места за этим столом уже оплачены.</div>
          )}

          {!loading && !errorText && seats.map(seat => (
            <div key={seat.seatNumber} className={styles.seatCard}>
              <div className={styles.seatHeader}>
                <label className={styles.seatCheckboxLabel}>
                  {!seat.isPaid && (
                    <input
                      type="checkbox"
                      checked={selected.has(seat.seatNumber)}
                      onChange={() => toggleSeat(seat.seatNumber)}
                      className={styles.checkbox}
                    />
                  )}
                  <span className={styles.seatName}>
                    Место {seat.seatNumber}{seat.seatNumber === mySeatNumber ? ' (вы)' : ''}
                  </span>
                </label>
                {seat.isPaid ? (
                  <span className={styles.paidBadge}>Оплачено</span>
                ) : (
                  <span className={styles.seatSubtotal}>{seat.subtotal} ₽</span>
                )}
              </div>
              <div className={styles.itemsList}>
                {seat.items.map((item, idx) => (
                  <div key={idx} className={styles.itemRow}>
                    <span>{item.dish_name} × {item.quantity}</span>
                    <span>{item.line_total} ₽</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {!loading && !errorText && hasUnpaidSeats && (
          <div className={styles.footer}>
            <div className={styles.totalRow}>
              <span>К оплате</span>
              <span>{selectedTotal} ₽</span>
            </div>
            <button
              className={styles.confirmBtn}
              disabled={selected.size === 0}
              onClick={handleConfirm}
            >
              Перейти к оплате
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SplitBillModal;
