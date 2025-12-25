import React, { useState, useEffect, useRef } from 'react';
import styles from './DishModal.module.css';

// Добавили пропсы currentCount и updateCart
const DishModal = ({ isOpen, onClose, dish, currentCount, updateCart }) => {
  const [isClosing, setIsClosing] = useState(false);
  
  const touchStart = useRef(null);
  const touchEnd = useRef(null);
  const modalRef = useRef(null);
  const minSwipeDistance = 50;

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
    touchEnd.current = null;
    touchStart.current = e.targetTouches[0].clientY;
  };

  const onTouchMove = (e) => {
    touchEnd.current = e.targetTouches[0].clientY;
    const distance = touchEnd.current - touchStart.current;
    if (distance > 0 && modalRef.current) {
      modalRef.current.style.transform = `translateY(${distance}px)`;
      modalRef.current.style.transition = 'none';
    }
  };

  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;
    const distance = touchEnd.current - touchStart.current;
    if (distance > minSwipeDistance) {
      handleClose();
    } else if (modalRef.current) {
      modalRef.current.style.transform = 'translateY(0)';
      modalRef.current.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)';
    }
  };

  if (!isOpen || !dish) return null;

  const isAlcohol = dish.product_type === 'alcohol';

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

        <div className={styles.imageContainer}>
          <img src={dish.image_url} alt={dish.dish_name} className={styles.mainImage} />
          <button className={styles.closeBtn} onClick={handleClose}>
            <img src="/icons/icon-on.png" alt="Close" />
          </button>
          <div className={styles.priceTag}>
            <div className={styles.priceText}>{dish.cost_rub} ₽</div>
            <div className={styles.weightText}>
              {dish.nutritional_info?.weight_value || dish.weight_g}
            </div>
          </div>
        </div>

        <div className={`${styles.content} ${isAlcohol ? styles.alcoholContent : ''}`}>
          
          {/* --- ВЕРСТКА ДЛЯ АЛКОГОЛЯ --- */}
          {isAlcohol ? (
            <div className={styles.alcoholWrapper}>
              <h2 className={styles.alcoholTitle}>{dish.dish_name}</h2>
              
              <div className={styles.specsContainer}>
                {dish.nutritional_info && Object.entries(dish.nutritional_info).map(([key, value]) => (
                  key !== 'weight_value' && (
                    <div key={key} className={styles.specRow}>
                      <span className={styles.specKey}>{key}:</span>
                      <span className={styles.specValue}>{value}</span>
                    </div>
                  )
                ))}
              </div>

              <h3 className={styles.alcoholSectionLabel}>Вкус</h3>
              <p className={styles.alcoholText}>{dish.ingredients}</p>

              <h3 className={styles.alcoholSectionLabel}>Аромат</h3>
              <p className={styles.alcoholText}>{dish.specific_details}</p>

              <h3 className={styles.alcoholSectionLabel}>Рекомендации к употреблению:</h3>
              <p className={styles.alcoholText}>{dish.description}</p>
            </div>
          ) : (
            /* --- ВЕРСТКА ДЛЯ ЕДЫ --- */
            <>
              <h3 className={styles.sectionTitle}>Описание:</h3>
              <p className={styles.descriptionText}>{dish.description}</p>

              <h3 className={styles.sectionTitle}>Состав:</h3>
              <p className={styles.ingredientsText}>
                {Array.isArray(dish.ingredients) ? dish.ingredients.join(', ') : dish.ingredients}
              </p>

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

          {/* Блок кнопок: теперь использует функцию updateCart */}
          <div className={styles.buttonActionGroup}>
            <button className={styles.chatButton}>
              <img src="/icons/foto-avatar.png" className={styles.chatAvatar} alt="AI Chat" />
            </button>

            {currentCount === 0 ? (
              <button className={styles.addToCartBtn} onClick={() => updateCart(dish.id, 1)}>
                Добавить в заказ
              </button>
            ) : (
              <div className={styles.counterBtn}>
                <button onClick={() => updateCart(dish.id, -1)} className={styles.minusBtn}>
                  <img src="/icons/icon-minus.png" alt="minus" className={styles.controlIcon} />
                </button>
                <span className={styles.countNumber}>{currentCount}</span>
                <button onClick={() => updateCart(dish.id, 1)} className={styles.plusBtn}>
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
