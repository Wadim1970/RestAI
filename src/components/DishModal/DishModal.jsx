import React, { useState, useEffect } from 'react';
import styles from './DishModal.module.css';

const DishModal = ({ isOpen, onClose, dish }) => {
  const [count, setCount] = useState(0);

useEffect(() => {
  if (isOpen) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = 'unset';
  }
  return () => { document.body.style.overflow = 'unset'; };
}, [isOpen]);
  
  if (!isOpen || !dish) return null;

  // Проверка типа продукта
  const isAlcohol = dish.product_type === 'alcohol';

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.modal} ${isOpen ? styles.open : ''}`} onClick={e => e.stopPropagation()}>
        
        {/* Изображение и элементы внутри него */}
        <div className={styles.imageContainer}>
          <img src={dish.image_url} alt={dish.dish_name} className={styles.mainImage} />
          
          {/* Декоративная линия сверху */}
          <div className={styles.dragLine}></div>
          
          {/* Кнопка закрытия */}
          <button className={styles.closeBtn} onClick={onClose}>
            <img src="/icons/icon-on.png" alt="Close" />
          </button>

          {/* Блок цены и веса */}
          <div className={styles.priceTag}>
            <div className={styles.priceText}>{dish.cost_rub} ₽</div>
            <div className={styles.weightText}>{dish.nutritional_info?.weight_value || dish.weight_g}</div>
          </div>
        </div>

        {/* Контентная часть */}
        <div className={styles.content}>
          {/* Описание */}
          <h3 className={styles.sectionTitle}>Описание:</h3>
          <p className={styles.descriptionText}>{dish.description}</p>

          {/* Состав */}
          <h3 className={styles.sectionTitle}>Состав:</h3>
          <p className={styles.ingredientsText}>
           {Array.isArray(dish.ingredients) 
           ? dish.ingredients.join(', ') 
           : dish.ingredients}
          </p>

          {/* Пищевая ценность (только для еды/напитков) */}
          {!isAlcohol && (
            <>
              <h3 className={styles.sectionTitle}>Пищевая ценность:</h3>
              <div className={styles.nutritionalGrid}>
                <div className={styles.nutriItem}>
                  <span className={styles.nutriValue}>{dish.nutritional_info?.calories_kcal || 0}</span>
                  <span className={styles.nutriLabel}>ккал</span>
                </div>
                <div className={styles.nutriItem}>
                  <span className={styles.nutriValue}>{dish.nutritional_info?.protein_g || 0}</span>
                  <span className={styles.nutriLabel}>белки</span>
                </div>
                <div className={styles.nutriItem}>
                  <span className={styles.nutriValue}>{dish.nutritional_info?.fat_g || 0}</span>
                  <span className={styles.nutriLabel}>жиры</span>
                </div>
                <div className={styles.nutriItem}>
                  <span className={styles.nutriValue}>{dish.nutritional_info?.carbs_g || 0}</span>
                  <span className={styles.nutriLabel}>углеводы</span>
                </div>
              </div>
            </>
          )}

          {/* Блок кнопок */}
          <div className={styles.buttonActionGroup}>
            {/* Кнопка Чата */}
            <button className={styles.chatButton}>
              <img src="/icons/avatar-ai.png" className={styles.chatAvatar} alt="AI Chat" />
            </button>

            {/* Кнопка Корзины */}
            {count === 0 ? (
              <button className={styles.addToCartBtn} onClick={() => setCount(1)}>
                Добавить в корзину
              </button>
            ) : (
              <div className={styles.counterBtn}>
                <button onClick={() => setCount(count - 1)} className={styles.minusBtn}>
                  <div className={styles.minusIcon}></div>
                </button>
                <span className={styles.countNumber}>{count}</span>
                <button onClick={() => setCount(count + 1)} className={styles.plusBtn}>
                  <div className={styles.plusIcon}></div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DishModal;
