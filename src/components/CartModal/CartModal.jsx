imimport React, { useState, useEffect, useRef } from 'react';
import styles from './CartModal.module.css';

const CartModal = ({ isOpen, onClose, cartItems = [], confirmedOrders = [], updateCart, onConfirmOrder }) => {
  const [comment, setComment] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  
  // Рефы для логики свайпа и скролла
  const touchStart = useRef(null);
  const touchEnd = useRef(null);
  const modalRef = useRef(null);
  const listRef = useRef(null); 
  const minSwipeDistance = 150;

  // ФЛАГИ ЗАЩИТЫ (Добавлены корректно)
  const canSwipeModal = useRef(false); 
  const isScrollingList = useRef(false); 

  // Авто-скролл вверх к кнопке "+ Добавить"
  useEffect(() => {
    if (confirmedOrders.length > 0 && listRef.current) {
      setTimeout(() => {
        listRef.current.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }, 100);
    }
  }, [confirmedOrders.length]);

  // Функция плавного закрытия
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  };

  // Блокировка скролла основной страницы
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setIsClosing(false);
    } else {
      document.body.style.overflow = 'unset';
    }
  }, [isOpen]);

  // --- ЛОГИКА СВАЙПА ---
  const onTouchStart = (e) => {
    touchEnd.current = null;
    touchStart.current = e.targetTouches[0].clientY;
    isScrollingList.current = false; // Сброс при новом касании
    
    // Если список в самом верху — разрешаем свайп модалки
    if (listRef.current && listRef.current.scrollTop <= 0) {
      canSwipeModal.current = true;
    } else {
      canSwipeModal.current = false;
    }
  };

  const onTouchMove = (e) => {
    touchEnd.current = e.targetTouches[0].clientY;
    const distance = touchEnd.current - touchStart.current;

    // Если список прокрутился хоть на 1 пиксель — это скролл контента
    if (listRef.current && listRef.current.scrollTop > 0) {
      isScrollingList.current = true;
    }

    // Двигаем модалку только если соблюдены все условия
    if (
      distance > 0 && 
      modalRef.current && 
      canSwipeModal.current && 
      !isScrollingList.current
    ) {
      modalRef.current.style.transform = `translateY(${distance}px)`;
      modalRef.current.style.transition = 'none';
      if (e.cancelable) e.preventDefault();
    }
  };

  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;

    const distance = touchEnd.current - touchStart.current;

    // Закрываем только если не было скролла списка и дистанция достаточна
    if (distance > minSwipeDistance && canSwipeModal.current && !isScrollingList.current) {
      handleClose();
    } else if (modalRef.current) {
      modalRef.current.style.transform = 'translateY(0)';
      modalRef.current.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)';
    }

    // Сброс всех значений
    touchStart.current = null;
    touchEnd.current = null;
    isScrollingList.current = false;
  };

  if (!isOpen) return null;

  const hasNewItems = cartItems.length > 0;
  const hasConfirmedItems = confirmedOrders.length > 0;

  const newItemsSum = cartItems.reduce((sum, item) => sum + (Number(item.cost_rub || 0) * Number(item.count || 0)), 0);
  const confirmedSum = confirmedOrders.reduce((sum, item) => sum + (Number(item.cost_rub || 0) * Number(item.count || 0)), 0);
  const totalSum = newItemsSum + confirmedSum;

  const handleOrderSubmit = () => {
    if (hasNewItems) {
      onConfirmOrder(cartItems);
      setComment('');
    }
  };

  return (
    <div 
      className={`${styles.overlay} ${isClosing ? styles.fadeOut : ''}`} 
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
            <button className={styles.addMoreBtn} onClick={handleClose}>
              + Добавить к заказу
            </button>
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

        <div className={styles.footer} onClick={() => document.activeElement.blur()}>
          {hasNewItems && (
            <textarea 
              className={styles.commentField}
              placeholder="Комментарий к заказу..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onClick={(e) => e.stopPropagation()} 
            />
          )}
          
          <div className={styles.totalRow}>
            <span>Итого к оплате</span>
            <span>{totalSum} ₽</span>
          </div>

          {hasNewItems ? (
            <button className={styles.orderBtn} onClick={handleOrderSubmit}>Отправить заказ</button>
          ) : (
            <button className={`${styles.orderBtn} ${styles.billBtn}`} onClick={() => console.log("Счет")}>
              Принести счет
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CartModal;
