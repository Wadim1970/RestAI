// src/components/CartModal.jsx
import React, { useState } from 'react';
import styles from './CartModal.module.css';

const CartModal = ({ isOpen, onClose, cartItems, updateCart, onOrder }) => {
  const [comment, setComment] = useState('');
  const [isOrdered, setIsOrdered] = useState(false);

  if (!isOpen) return null;

  // Считаем общую сумму
  const totalSum = cartItems.reduce((sum, item) => sum + (item.cost_rub * item.count), 0);

  const handleOrderSubmit = () => {
    setIsOrdered(true);
    onOrder(comment); // Вызываем функцию отправки
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
          {cartItems.map(item => (
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
          ))}
        </div>

        <div className={styles.footer}>
          <textarea 
            className={styles.commentField}
            placeholder="Комментарий к заказу..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={isOrdered}
          />
          
          <div className={styles.totalRow}>
            <span>Итого</span>
            <span>{totalSum} ₽</span>
          </div>

          <button 
            className={`${styles.orderBtn} ${isOrdered ? styles.ordered : ''}`}
            onClick={handleOrderSubmit}
          >
            {isOrdered ? 'Принести счет' : 'Отправить заказ'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CartModal;
