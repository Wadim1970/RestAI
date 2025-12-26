import React, { useState } from 'react';
import styles from './CartModal.module.css';

const CartModal = ({ isOpen, onClose, cartItems = [], confirmedOrders = [], updateCart, onConfirmOrder }) => {
  const [comment, setComment] = useState('');

  if (!isOpen) return null;

  const hasNewItems = cartItems.length > 0;
  const hasConfirmedItems = confirmedOrders.length > 0;

  // Безопасный расчет сумм
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
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.dragLine}></div>
        
        <div className={styles.header}>
          <h2 className={styles.title}>Ваш заказ</h2>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.itemList}>
          {/* НОВЫЕ БЛЮДА (с кнопками +/-) */}
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

          {/* КНОПКА ДОБАВИТЬ (только если есть подтвержденные) */}
          {hasConfirmedItems && (
            <button className={styles.addMoreBtn} onClick={onClose}>
              + Добавить к заказу
            </button>
          )}

          {/* ПОДТВЕРЖДЕННЫЕ (без кнопок изменения) */}
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
