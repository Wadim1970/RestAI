import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import styles from './PaymentFlowModal.module.css';

// Поток самостоятельной оплаты гостем: чек (заглушка) -> СБП (заглушка) ->
// подтверждение оплаты. Важное правило: места помечаются 'paid'
// (pay_table_seats) ТОЛЬКО после "оплаты" — здесь на шаге подтверждения, а
// не в момент выбора корзин. Иначе стол закрывался бы у официанта до денег.
//
// Реальная фискализация (54-ФЗ / ОФД) и живой СБП подключаются позже — сейчас
// чек и ссылка СБП это плейсхолдеры, а "оплата" это мок-кнопка для сквозного
// теста сценария.
const PaymentFlowModal = ({ isOpen, onClose, restaurantId, tableNumber, seatNumbers, onPaid }) => {
  const [step, setStep] = useState('receipt'); // 'receipt' | 'sbp'
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [errorText, setErrorText] = useState('');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStep('receipt');
    setErrorText('');

    let cancelled = false;
    (async () => {
      setLoading(true);
      // Чек берём с сервера (get_table_bill) и фильтруем на выбранные места —
      // цены авторитетные, не из браузера.
      const { data, error } = await supabase.rpc('get_table_bill', {
        p_restaurant_id: restaurantId,
        p_table_number: String(tableNumber),
      });

      if (cancelled) return;

      if (error) {
        console.error('Ошибка загрузки чека:', error);
        setErrorText('Не удалось загрузить чек. Попробуйте ещё раз.');
        setLoading(false);
        return;
      }

      const wanted = new Set(seatNumbers || []);
      const lines = (data || []).filter(r => wanted.has(r.seat_number));
      setItems(lines);
      setTotal(lines.reduce((s, r) => s + Number(r.line_total || 0), 0));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [isOpen, restaurantId, tableNumber, seatNumbers]);

  // "Оплата прошла" (пока мок). Только теперь помечаем места оплаченными.
  const handleConfirmPaid = async () => {
    if (paying) return;
    setPaying(true);
    setErrorText('');

    try {
      const { error } = await supabase.rpc('pay_table_seats', {
        p_restaurant_id: restaurantId,
        p_table_number: String(tableNumber),
        p_seat_numbers: seatNumbers,
      });

      if (error) {
        console.error('Ошибка отметки оплаты:', error);
        setErrorText('Не удалось подтвердить оплату. Попробуйте ещё раз.');
        setPaying(false);
        return;
      }

      onPaid();
    } catch (e) {
      console.error('Системная ошибка оплаты:', e);
      setErrorText('Не удалось подтвердить оплату. Попробуйте ещё раз.');
      setPaying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        {step === 'receipt' && (
          <>
            <div className={styles.header}>
              <h2 className={styles.title}>Кассовый чек</h2>
              <button className={styles.closeBtn} onClick={onClose}>✕</button>
            </div>
            <div className={styles.stubBadge}>предварительный чек · тест</div>

            <div className={styles.body}>
              {loading && <div className={styles.infoText}>Загрузка...</div>}
              {!loading && errorText && <div className={styles.infoText}>{errorText}</div>}
              {!loading && !errorText && items.length === 0 && (
                <div className={styles.infoText}>Нет позиций к оплате.</div>
              )}
              {!loading && !errorText && items.map((it, i) => (
                <div key={i} className={styles.itemRow}>
                  <span>{it.dish_name} × {it.quantity}</span>
                  <span>{it.line_total} ₽</span>
                </div>
              ))}
            </div>

            <div className={styles.footer}>
              <div className={styles.totalRow}>
                <span>Итого</span>
                <span>{total} ₽</span>
              </div>
              <button
                className={styles.primaryBtn}
                disabled={loading || !!errorText || total === 0}
                onClick={() => setStep('sbp')}
              >
                Оплатить через СБП
              </button>
            </div>
          </>
        )}

        {step === 'sbp' && (
          <>
            <div className={styles.header}>
              <h2 className={styles.title}>Оплата через СБП</h2>
              <button className={styles.closeBtn} onClick={onClose}>✕</button>
            </div>

            <div className={styles.sbpBox}>
              <div className={styles.qrStub}>QR-код СБП<br />(заглушка)</div>
              <span className={styles.sbpLink}>Ссылка для оплаты через СБП (заглушка)</span>
              <div className={styles.sbpAmount}>{total} ₽</div>
            </div>

            {errorText && <div className={styles.infoText}>{errorText}</div>}

            <div className={styles.footer}>
              <button className={styles.primaryBtn} disabled={paying} onClick={handleConfirmPaid}>
                {paying ? 'Подтверждаем...' : '✅ Я оплатил (тест)'}
              </button>
              <button className={styles.secondaryBtn} onClick={() => setStep('receipt')}>
                Назад к чеку
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
};

export default PaymentFlowModal;
