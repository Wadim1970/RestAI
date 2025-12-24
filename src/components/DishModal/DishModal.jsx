import React, { useState, useEffect, useRef } from 'react';
import styles from './DishModal.module.css';

const DishModal = ({ isOpen, onClose, dish }) => {
  const [count, setCount] = useState(0);
  
  // Рефы для отслеживания свайпа
  const touchStart = useRef(null);
  const touchEnd = useRef(null);
  const modalRef = useRef(null);

  // Минимальное расстояние для срабатывания свайпа (в пикселях)
  const minSwipeDistance = 50;

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  // Обработчики свайпа
  const onTouchStart = (e) => {
    touchEnd.current = null;
    touchStart.current = e.targetTouches[0].clientY;
  };

  const onTouchMove = (e) => {
    touchEnd.current = e.targetTouches[0].clientY;
    
    // Визуальный эффект: если тянем вниз, смещаем окно (опционально)
    const distance = touchEnd.current - touchStart.current;
    if (distance > 0 && modalRef.current) {
      modalRef.current.style.transform = `translateY(${distance}px)`;
      modalRef.current.style.transition = 'none'; // Убираем анимацию при движении пальцем
    }
  };

  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;
    
    const distance = touchEnd.current - touchStart.current;
    const isSwipeDown = distance > minSwipeDistance;

    if (isSwipeDown) {
      onClose(); // Закрываем, если свайпнули вниз
    } else if (modalRef.current) {
      // Возвращаем окно на место, если свайп был коротким
      modalRef.current.style.transform = 'translateY(0)';
      modalRef.current.style.transition = 'transform 0.3s ease-out';
    }
  };

  if (!isOpen || !dish) return null;

  const isAlcohol = dish.product_type === 'alcohol';

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div 
        ref={modalRef}
        className={styles.modal} 
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Полоска сверху, за которую "тянем" */}
        <div className={styles.dragLine}></div>

        <div className={styles.imageContainer}>
          <img src={dish.image_url} alt={dish.dish_name} className={styles.mainImage} />
          
          <button className={styles.closeBtn} onClick={onClose}>
            <img src="/icons/icon-on.png" alt="Close" />
          </button>

          <div className={styles.priceTag}>
            <div className={styles.priceText}>{dish.cost_rub} ₽</div>
            <div className={styles.weightText}>
              {(dish.nutritional_info?.weight_value || dish.weight_g || '').toString().replace('/', '')}
            </div>
          </div>
        </div>

        <div className={styles.content}>
          <h3 className={styles.sectionTitle}>Описание:</h3>
          <p className={styles.descriptionText}>{dish.description}</p>

          <h3 className={styles.sectionTitle}>Состав:</h3>
          <p className={styles.ingredientsText}>
            {Array.isArray(dish.ingredients) ? dish.ingredients.join(', ') : dish.ingredients}
          </p>

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

          <div className={styles.buttonActionGroup}>
            <button className={styles.chatButton}>
              <img src="/icons/foto-avatar.png" className={styles.chatAvatar} alt="AI Chat" />
            </button>

            {count === 0 ? (
              <button className={styles.addToCartBtn} onClick={() => setCount(1)}>
                Добавить в заказ
              </button>
            ) : (
              <div className={styles.counterBtn}>
                <button onClick={() => setCount(count - 1)} className={styles.minusBtn}>
                  <img src="/icons/icon-minus.png" alt="minus" className={styles.controlIcon} />
                </button>
                <span className={styles.countNumber}>{count}</span>
                <button onClick={() => setCount(count + 1)} className={styles.plusBtn}>
                  <img src="/icons/icon-plus.png" alt="plus" className={styles.controlIcon} />
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
