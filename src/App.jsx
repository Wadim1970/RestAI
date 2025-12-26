// src/App.jsx
// src/components/CartModal/CartModal.jsx
import React, { useState } from 'react';
import styles from './CartModal.module.css';

const CartModal = ({ isOpen, onClose, cartItems, confirmedOrders, updateCart, onConfirmOrder }) => {
  const [comment, setComment] = useState('');

  if (!isOpen) return null;

  const hasNewItems = cartItems.length > 0;
  const hasConfirmedItems = confirmedOrders.length > 0;

  // Считаем сумму только для новых (еще не отправленных) позиций
  const newItemsSum = cartItems.reduce((sum, item) => sum + (item.cost_rub * item.count), 0);
  
  // Считаем общую сумму всего стола (новое + старое)
  const confirmedSum = confirmedOrders.reduce((sum, item) => sum + (item.cost_rub * item.count), 0);
  const totalSum = newItemsSum + confirmedSum;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.dragLine}></div>
        
        <div className={styles.header}>
          <h2 className={styles.title}>Ваш заказ</h2>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.itemList}>
          {/* --- БЛОК НОВЫХ БЛЮД --- */}
          {hasNewItems ? (
            cartItems.map(item => (
              <div key={item.id} className={styles.cartItem}>
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
            ))
          ) : !hasConfirmedItems ? (
            <div className={styles.emptyText}>В корзине пока пусто</div>
          ) : null}

          {/* --- БЛОК КНОПКИ "ДОБАВИТЬ К ЗАКАЗУ" --- */}
          {/* Показываем её только если уже есть отправленные заказы, чтобы гость мог вернуться в меню */}
          {hasConfirmedItems && (
            <button className={styles.addMoreBtn} onClick={onClose}>
              + Добавить к заказу
            </button>
          )}

          {/* --- БЛОК УЖЕ ЗАКАЗАННЫХ БЛЮД (ГОТОВИТСЯ) --- */}
          {hasConfirmedItems && (
            <div className={styles.confirmedSection}>
              <h3 className={styles.sectionDivider}>Уже готовится</h3>
              {confirmedOrders.map((item, index) => (
                <div key={`${item.id}-${index}`} className={`${styles.cartItem} ${styles.confirmedItem}`}>
                  <img src={item.image_url} alt={item.dish_name} className={styles.itemImg} />
                  <div className={styles.itemInfo}>
                    <div className={styles.itemName}>{item.dish_name}</div>
                    <div className={styles.itemPrice}>{item.count} шт. · {item.cost_rub * item.count} ₽</div>
                  </div>
                  {/* Здесь кнопок нет, заказ уже на кухне */}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {hasNewItems && (
            <textarea 
              className={styles.commentField}
              placeholder="Комментарий к заказу (например, без лука)..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
          
          <div className={styles.totalRow}>
            <span>Итого к оплате</span>
            <span>{totalSum} ₽</span>
          </div>

          {hasNewItems ? (
            <button 
              className={styles.orderBtn}
              onClick={() => onConfirmOrder(cartItems)}
            >
              Отправить заказ
            </button>
          ) : (
            <button 
              className={`${styles.orderBtn} ${styles.billBtn}`}
              onClick={() => console.log("Запрос счета")}
            >
              Принести счет
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CartModal;
