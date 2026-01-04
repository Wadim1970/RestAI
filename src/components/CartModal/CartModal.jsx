import React, { useState, useEffect, useRef } from 'react';
import styles from './CartModal.module.css';

const CartModal = ({ isOpen, onClose, cartItems = [], confirmedOrders = [], updateCart, onConfirmOrder }) => {
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
      document.body.style.overflow = 'hidden';
      setIsClosing(false);
    } else {
      document.body.style.overflow = 'unset';
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
  const totalSum = [...cartItems, ...confirmedOrders].reduce((sum, item) => sum + (Number(item.cost_rub || 0) * Number(item.count || 0)), 0);

  return (
    <div className={`${styles.overlay} ${isClosing ? styles.fadeOut : ''}`} onClick={handleClose}>
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
          <button className={styles.closeBtn} onClick={handleClose}>×</button>
        </div>

        <div className={styles.itemList} ref={listRef}>
          {hasNewItems && (
            <div className={styles.newItemsSection}>
              {cartItems.map(item => (
                <div key={`new-${item.id}`} className={styles.cartItem}>
                  <img src={item.image_url} alt={item.dish_name} className={styles.itemImg} />
                  <div className={styles.itemInfo}>
                    <div className={styles.itemName}>{item.dish_name}</div>
                    <div className={styles.itemPrice}>{item.cost_rub} ₽</div>
                  </div>
                  <div className={styles.counter}>
                    <button onClick={() => updateCart(item.id, -1)} className={styles.countBtn}>-</button>
                    <span className={styles.countNumber}>{item.count}</span>
                    <button onClick={() => updateCart(item.id, 1)} className={styles.countBtn}>+</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hasConfirmedItems && (
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
                    <div className={styles.itemPrice}>{item.count} шт. · {item.cost_rub * item.count} ₽</div>
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
          <button 
            className={`${styles.orderBtn} ${!hasNewItems ? styles.billBtn : ''}`} 
            onClick={hasNewItems ? () => { onConfirmOrder(cartItems); setComment(''); } : () => console.log("Счет")}
          >
            {hasNewItems ? 'Отправить заказ' : 'Принести счет'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CartModal;
