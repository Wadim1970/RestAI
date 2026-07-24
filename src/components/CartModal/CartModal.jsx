import React, { useState, useEffect, useRef } from 'react';
import styles from './CartModal.module.css';

const CartModal = ({ isOpen, onClose, cartItems = [], confirmedOrders = [], updateCart, onConfirmOrder, onRequestBill, overlayZIndex }) => {
  const [comment, setComment] = useState(''); // Состояние для текста комментария
  const [isClosing, setIsClosing] = useState(false); // Состояние для запуска анимации закрытия
     
  const touchStart = useRef(null); // Храним координату Y начала касания
  const touchEnd = useRef(null); // Храним координату Y конца/движения касания
  const modalRef = useRef(null); // Ссылка на само окно (чтобы его двигать)
  const listRef = useRef(null);  // Ссылка на скроллящийся список внутри модалки
  const minSwipeDistance = 150; // Минимальный свайп в пикселях для закрытия окна

  // --- ЭФФЕКТ ДЛЯ БЛОКИРОВКИ ПЕРЕЗАГРУЗКИ (PULL-TO-REFRESH) ---
  useEffect(() => {
    const listEl = listRef.current;
    if (!isOpen || !listEl) return;

    // Специальная функция для отмены системного поведения браузера
    const handleSystemScroll = (e) => {
      const distance = e.touches[0].clientY - touchStart.current;
      // Если список в самом верху И пользователь тянет вниз
      if (distance > 0 && listEl.scrollTop <= 0) {
        // Отменяем стандартное действие (перезагрузку), если событие можно отменить
        if (e.cancelable) e.preventDefault();
      }
    };

    // Вешаем обработчик напрямую на DOM-элемент с параметром { passive: false }
    // Только так preventDefault() сработает и страница не перезагрузится
    listEl.addEventListener('touchmove', handleSystemScroll, { passive: false });

    // Убираем обработчик при закрытии модалки
    return () => listEl.removeEventListener('touchmove', handleSystemScroll);
  }, [isOpen]);

  // Авто-скролл вверх при изменении заказов
  useEffect(() => {
    if (confirmedOrders.length > 0 && listRef.current) {
      setTimeout(() => {
        listRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
    }
  }, [confirmedOrders.length]);

  // Функция запуска анимации и закрытия
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  };

  // Блокировка скролла body при открытой модалке
  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
    }
  }, [isOpen]);

  // Начало касания
  const onTouchStart = (e) => {
    touchStart.current = e.targetTouches[0].clientY;
    touchEnd.current = e.targetTouches[0].clientY;
  };

  // Движение пальца
  const onTouchMove = (e) => {
    touchEnd.current = e.targetTouches[0].clientY;
    const distance = touchEnd.current - touchStart.current;

    // Если тянем вниз и список в самом верху
    if (distance > 0 && listRef.current && listRef.current.scrollTop <= 0) {
      if (modalRef.current) {
        // Визуально сдвигаем модалку вслед за пальцем
        modalRef.current.style.transform = `translateY(${distance}px)`;
        modalRef.current.style.transition = 'none'; // Убираем анимацию во время перетаскивания
      }
    }
  };

  // Окончание касания
  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;

    const distance = touchEnd.current - touchStart.current;

    // Если сдвинули больше лимита — закрываем
    if (distance > minSwipeDistance && listRef.current && listRef.current.scrollTop <= 0) {
      handleClose();
    } else if (modalRef.current) {
      // Иначе плавно возвращаем на место
      modalRef.current.style.transform = 'translateY(0)';
      modalRef.current.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)';
    }

    touchStart.current = null;
    touchEnd.current = null;
  };

  if (!isOpen) return null;

  const hasNewItems = cartItems.length > 0;
  const hasConfirmedItems = confirmedOrders.length > 0;

  // Наценка за выбранные опции блюда (сумма price_delta модификаторов) и
  // итоговая цена порции = базовая цена + наценка.
  const modDeltaOf = (item) => (item?.modifiers || []).reduce((s, m) => s + (Number(m?.price_delta) || 0), 0);
  const unitPriceOf = (item) => Number(item.cost_rub || 0) + modDeltaOf(item);
  const totalSum = [...cartItems, ...confirmedOrders].reduce((sum, item) => sum + (unitPriceOf(item) * Number(item.count || 0)), 0);

  // Калорийность блюда берём из nutritional_info.calories_kcal (на порцию),
  // умножаем на количество. Блюда без данных считаем как 0 — общий итог не
  // ломается. newItemsKcal — калорийность только добавляемых блюд; totalKcal —
  // всего заказа (уже на кухне + добавляемые).
  const kcalOf = (item) => Number(item?.nutritional_info?.calories_kcal || 0) * Number(item?.count || 0);
  const newItemsKcal = Math.round(cartItems.reduce((sum, item) => sum + kcalOf(item), 0));
  const totalKcal = Math.round([...cartItems, ...confirmedOrders].reduce((sum, item) => sum + kcalOf(item), 0));

  return (
    <div
      className={`${styles.overlay} ${isClosing ? styles.fadeOut : ''}`}
      style={overlayZIndex ? { zIndex: overlayZIndex } : undefined}
      onClick={handleClose}
    >
      <div 
        ref={modalRef}
        className={`${styles.modal} ${isClosing ? styles.slideDown : ''}`} 
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className={styles.dragLine}></div>
        
        <div className={styles.header}>
          <h2 className={styles.title}>Ваш заказ</h2>
          <button className={styles.closeBtn} onClick={handleClose}>
  <img src="/icons/icon-on.png" alt="Close" />
</button>
        </div>

        <div className={styles.itemList} ref={listRef}>
          {hasNewItems && (
            <div className={styles.newItemsSection}>
              {cartItems.map(item => (
                <div key={`new-${item.id}`} className={styles.cartItem}>
                  <img src={item.image_url} alt={item.dish_name} className={styles.itemImg} />
                  <div className={styles.itemInfo}>
                    <div className={styles.itemName}>{item.dish_name}</div>
                    <div className={styles.itemPrice}>{unitPriceOf(item)} ₽</div>
                    {item.modifiers?.length > 0 && (
                      <div className={styles.itemMods}>
                        {item.modifiers.map((m, idx) => (
                          <span key={idx} className={styles.itemMod}>
                            {m.name}{Number(m.price_delta) ? ` +${m.price_delta}₽` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.comment && <div className={styles.itemComment}>{item.comment}</div>}
                  </div>
                  <div className={styles.counter}>
                    <button onClick={() => updateCart(-1, item.id)} className={styles.countBtn}>-</button>
                    <span className={styles.countNumber}>{item.count}</span>
                    <button onClick={() => updateCart(1, item.id)} className={styles.countBtn}>+</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Добавляем новые блюда к уже отправленному заказу — вместо кнопки
              показываем калорийность добавляемого. Кнопка тут путала: гость
              думал, что ею надо «досдать» уже выбранное в корзине. */}
          {hasNewItems && hasConfirmedItems && (
            <div className={styles.addedCaloriesRow}>
              <span>Калорийность добавляемых</span>
              <span>{newItemsKcal} кКал</span>
            </div>
          )}

          {/* Кнопку «Добавить к заказу» показываем ТОЛЬКО когда всё из корзины
              уже отправлено на кухню (новых блюд нет) — тогда она по смыслу
              верна: гость хочет добавить ещё. */}
          {!hasNewItems && hasConfirmedItems && (
            <button className={styles.addMoreBtn} onClick={handleClose}>+ Добавить к заказу</button>
          )}

          {hasConfirmedItems && (
            <div className={styles.confirmedSection}>
              <h3 className={styles.sectionDivider}>Уже готовится</h3>
              {confirmedOrders.map((item, index) => (
                <div key={`conf-${item.id}-${index}`} className={`${styles.cartItem} ${styles.confirmedItem}`}>
                  <img src={item.image_url} alt={item.dish_name} className={styles.itemImg} />
                  <div className={styles.itemInfo}>
                    <div className={styles.itemName}>{item.dish_name}</div>
                    <div className={styles.itemPrice}>{item.count} шт. · {unitPriceOf(item) * item.count} ₽</div>
                    {item.modifiers?.length > 0 && (
                      <div className={styles.itemMods}>
                        {item.modifiers.map((m, idx) => (
                          <span key={idx} className={styles.itemMod}>
                            {m.name}{Number(m.price_delta) ? ` +${m.price_delta}₽` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.comment && <div className={styles.itemComment}>{item.comment}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!hasNewItems && !hasConfirmedItems && <div className={styles.emptyText}>Корзина пуста</div>}
        </div>

        <div className={styles.footer}>
          {hasNewItems && (
            <textarea 
              className={styles.commentField}
              placeholder="Комментарий к заказу..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
          <div className={styles.totalRow}>
            <span>Итого к оплате</span>
            <span>{totalSum} ₽</span>
          </div>
          {(hasNewItems || hasConfirmedItems) && (
            <div className={styles.caloriesRow}>
              <span>Общая калорийность</span>
              <span>{totalKcal} кКал</span>
            </div>
          )}
          <button
            className={`${styles.orderBtn} ${!hasNewItems ? styles.billBtn : ''}`} 
            onClick={hasNewItems 
              ? () => { onConfirmOrder(cartItems, comment); setComment(''); } 
              : () => { onRequestBill(); onClose(); }
            }
          >
            {hasNewItems ? 'Отправить заказ' : 'Принести счет'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CartModal;
