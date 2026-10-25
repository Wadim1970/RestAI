import { useEffect, useState } from 'react';
import styles from '../PairingSheet/PairingSheet.module.css';
import own from './DessertSheet.module.css';
import { formatPrice } from '../../lib/menuFormat';
import { dishThumb, fallbackToPhoto } from '../../lib/dishImage';

// «Самое время для десерта»: гость разрешил напомнить — пришло время (горячее
// съедено). Два-три десерта к этому приёму пищи, «+» — в заказ.
export default function DessertSheet({ offer, dishesById, onAdd, onClose }) {
  const [visible, setVisible] = useState(false);
  const [added, setAdded] = useState({});

  useEffect(() => {
    if (!offer) return undefined;
    const raf = requestAnimationFrame(() => setVisible(true));
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); };
  }, [offer, onClose]);

  if (!offer) return null;
  const list = (offer.desserts || []).map((d) => ({ ...d, dish: dishesById.get(d.id) })).filter((d) => d.dish);
  if (!list.length) return null;

  return (
    <div className={styles.root}>
      <div className={`${styles.veil} ${visible ? styles.on : ''}`} onClick={onClose} />
      <div className={`${styles.sheet} ${visible ? styles.on : ''}`} role="dialog" aria-modal="true" aria-labelledby="dessert-title">
        <div className={styles.grab} />
        <div className={styles.who}>
          <img src="/icons/foto-avatar.png" alt="" className={styles.avatar} />
          <span>Шеф советует</span>
        </div>
        <p className={styles.lead} id="dessert-title">{offer.title}</p>
        <p className={own.text}>{offer.text}</p>
        <div className={own.list}>
          {list.map(({ id, why, dish }) => {
            const img = dishThumb(dish);
            return (
              <div key={id} className={own.row}>
                <div className={own.photo}>{img && <img src={img} alt={dish.dish_name} onError={fallbackToPhoto(dish)} />}</div>
                <div className={own.info}>
                  <b>{dish.dish_name}</b>
                  {why && <span>{why}</span>}
                  <span className={own.price}>{formatPrice(dish.cost_rub)}</span>
                </div>
                <button
                  type="button"
                  className={`${own.add} ${added[id] ? own.added : ''}`}
                  onClick={() => { if (!added[id]) { onAdd(id); setAdded((a) => ({ ...a, [id]: true })); } }}
                  aria-label={added[id] ? `${dish.dish_name} в заказе` : `Добавить ${dish.dish_name}`}
                >
                  {added[id] ? '✓' : '+'}
                </button>
              </div>
            );
          })}
        </div>
        <div className={own.footer}>
          <button type="button" className={styles.ghost} onClick={onClose}>
            {Object.keys(added).length ? 'Готово' : 'Спасибо, не сейчас'}
          </button>
        </div>
      </div>
    </div>
  );
}
