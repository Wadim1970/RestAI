import React, { useState, useEffect, useRef } from 'react';
import styles from './CartModal.module.css';

const CartModal = ({ isOpen, onClose, cartItems = [], confirmedOrders = [], updateCart, onConfirmOrder }) => {
  const [comment, setComment] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  
  const touchStart = useRef(null);
  const touchEnd = useRef(null);
  const modalRef = useRef(null);
  const listRef = useRef(null); 
  const minSwipeDistance = 150;

  // Авто-скролл вверх
  useEffect(() => {
    if (confirmedOrders.length > 0 && listRef.current) {
      setTimeout(() => {
        listRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
    }
  }, [confirmedOrders.length]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setIsClosing(false);
    } else {
      document.body.style.overflow = 'unset';
    }
  }, [isOpen]);

  const onTouchStart = (e) => {
    touchStart.current = e.targetTouches[0].clientY;
    touchEnd.current = e.targetTouches[0].clientY;
  };

  const onTouchMove = (e) => {
    touchEnd.current = e.targetTouches[0].clientY;
    const distance = touchEnd.current - touchStart.current;

    // ПРАВИЛО: Если мы тянем вниз И список блюд находится в самом верху
    if (distance > 0 && listRef.current && listRef.current.scrollTop <= 0) {
      if (modalRef.current) {
        modalRef.current.style.transform = `translateY(${distance}px)`;
        modalRef.current.style.transition = 'none';
      }
      // Предотвращаем системный скролл, чтобы модалка ехала плавно
      if (e.cancelable) e.preventDefault();
    }
  };

  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;

    const distance = touchEnd.current - touchStart.current;

    // Если модалка была сдвинута
    if (distance > minSwipeDistance && listRef.current && listRef.current.scrollTop <= 0) {
      handleClose();
    } else if (modalRef.current) {
      // Пружиним назад
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

        {/* ОСНОВНОЙ СПИСОК */}
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
