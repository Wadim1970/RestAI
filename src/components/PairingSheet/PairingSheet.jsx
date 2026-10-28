import { useEffect, useRef, useState } from 'react';
import styles from './PairingSheet.module.css';
import { formatPrice, formatWeight } from '../../lib/menuFormat';
import { dishThumb, fallbackToPhoto } from '../../lib/dishImage';
import { adviserLabel } from '../../lib/adviser';

// Подсказка шефа после добавления блюда: «К пицце Пепперони отлично подходит
// салат с бурратой». Выезжает снизу поверх нижнего бара только на время
// выбора; после «Добавить», «Нет, спасибо», тапа мимо или Esc исчезает
// полностью — свёрнутого состояния нет.
export default function PairingSheet({ offer, dish, onAccept, onDecline }) {
  if (!offer || !dish) return null;
  // key — каждое новое предложение монтируется заново и снова выезжает.
  return <Sheet key={`${offer.anchorId}>${offer.dishId}`} offer={offer} dish={dish} onAccept={onAccept} onDecline={onDecline} />;
}

function Sheet({ offer, dish, onAccept, onDecline }) {
  const [visible, setVisible] = useState(false);
  const acceptRef = useRef(null);

  // Монтируем закрытой и открываем на следующем кадре — иначе нет анимации.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    const focus = setTimeout(() => acceptRef.current?.focus({ preventScroll: true }), 320);
    return () => { cancelAnimationFrame(raf); clearTimeout(focus); };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onDecline(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDecline]);

  const weight = formatWeight(dish);
  const img = dishThumb(dish);

  return (
    <div className={styles.root}>
      <div className={`${styles.veil} ${visible ? styles.on : ''}`} onClick={onDecline} />
      <div
        className={`${styles.sheet} ${visible ? styles.on : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pairing-lead"
      >
        <div className={styles.grab} />
        <div className={styles.who}>
          <img src="/icons/foto-avatar.png" alt="" className={styles.avatar} />
          <span>{adviserLabel(dish)}</span>
        </div>
        <p className={styles.lead} id="pairing-lead">{offer.lead}</p>
        <div className={styles.offer}>
          <div className={styles.photo}>
            {img && (
              <img
                src={img}
                alt={dish.dish_name}
                onError={fallbackToPhoto(dish)}
              />
            )}
          </div>
          <div className={styles.text}>
            <b>{dish.dish_name}</b>
            <span className={styles.why}>{offer.why}</span>
            <span className={styles.price}>{formatPrice(dish.cost_rub)}{weight ? ` · ${weight}` : ''}</span>
          </div>
        </div>
        <div className={styles.buttons}>
          <button type="button" className={styles.ghost} onClick={onDecline}>Нет, спасибо</button>
          <button type="button" className={styles.main} onClick={onAccept} ref={acceptRef}>
            Добавить · {formatPrice(dish.cost_rub)}
          </button>
        </div>
      </div>
    </div>
  );
}
