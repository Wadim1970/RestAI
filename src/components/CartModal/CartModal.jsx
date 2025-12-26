// src/components/CartModal.jsx
import React, { useState } from 'react';
import styles from './CartModal.module.css';

const CartModal = ({ 
  isOpen, 
  onClose, 
  cartItems, 
  confirmedOrders, // Принимаем историю заказов
  updateCart, 
  onConfirmOrder    // Принимаем функцию отправки из App.js
}) => {
  const [comment, setComment] = useState('');

  if (!isOpen) return null;

  const hasNewItems = cartItems.length > 0;
  const hasConfirmedItems = confirmedOrders.length > 0;

  // Сумма за новые позиции
 const newItemsSum = (cartItems || []).reduce((sum, item) => sum + (Number(item.cost_rub || 0) * Number(item.count || 0)), 0);
const confirmedSum = (confirmedOrders || []).reduce((sum, item) => sum + (Number(item.cost_rub || 0) * Number(item.count || 0)), 0);
const totalSum = newItemsSum + confirmedSum;

  const handleOrderSubmit = () => {
    onConfirmOrder(cartItems); // Передаем новые блюда в confirmedOrders через App.js
    setComment(''); // Очищаем комментарий для следующего дозаказа
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
          {/* 1. Блок новых блюд */}
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
          ) : !hasConfirmedItems && (
            <div className={styles.emptyText}>В корзине пока пусто</div>
          )}

          {/* 2. Кнопка "Добавить к заказу" (закрывает модалку) */}
          {hasConfirmedItems && (
            <button className={styles.addMoreBtn} onClick={onClose}>
              + Добавить к заказу
            </button>
          )}

          {/* 3. Блок "Уже готовится" (статичный список) */}
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
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {/* Поле комментария только для новых заказов */}
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
            <button 
              className={styles.orderBtn}
              onClick={handleOrderSubmit}
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
