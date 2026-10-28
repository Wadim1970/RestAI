import styles from './CartAdvice.module.css';
import { formatPrice, formatWeight } from '../../lib/menuFormat';
import { dishThumb, fallbackToPhoto } from '../../lib/dishImage';
import { adviserLabel, adviserRegion } from '../../lib/adviser';

// Совет в корзине: чего не хватает к этому завтраку, обеду или ужину
// («к стейку — перечный соус»), или — если всего хватает — похвала выбора и
// вопрос «можно мы чуть позже предложим десерт?». Одна карточка, заказ не
// блокирует: «Нет, спасибо» — и больше это не предлагаем.
export default function CartAdvice({ advice, dish, dessertAnswer, onAccept, onDecline, onDessert }) {
  if (!advice) return null;

  if (advice.kind === 'suggest') {
    if (!dish) return null;
    const weight = formatWeight(dish);
    const img = dishThumb(dish);
    return (
      <div className={styles.card} role="region" aria-label={adviserRegion(dish)}>
        <Who dish={dish} />
        <p className={styles.title}>{advice.title}</p>
        <div className={styles.offer}>
          <div className={styles.photo}>
            {img && <img src={img} alt={dish.dish_name} onError={fallbackToPhoto(dish)} />}
          </div>
          <div className={styles.text}>
            <b>{dish.dish_name}</b>
            {advice.text && <span className={styles.why}>{advice.text}</span>}
            <span className={styles.price}>{formatPrice(dish.cost_rub)}{weight ? ` · ${weight}` : ''}</span>
          </div>
        </div>
        <div className={styles.buttons}>
          <button type="button" className={styles.ghost} onClick={onDecline}>Нет, спасибо</button>
          <button type="button" className={styles.main} onClick={onAccept}>Добавить · {formatPrice(dish.cost_rub)}</button>
        </div>
      </div>
    );
  }

  if (advice.kind === 'complete') {
    // Ответил «да» — коротко подтверждаем; «нет» — молчим дальше.
    if (dessertAnswer === 'no') return null;
    return (
      <div className={`${styles.card} ${styles.praise}`} role="region" aria-label="Совет шефа">
        <Who />
        <p className={styles.title}>{advice.title}</p>
        {dessertAnswer === 'yes'
          ? <p className={styles.note}>Договорились! Чуть позже предложим вам десерт.</p>
          : <p className={styles.note}>{advice.text}</p>}
        {advice.askDessert && !dessertAnswer && (
          <div className={styles.buttons}>
            <button type="button" className={styles.ghost} onClick={() => onDessert(false)}>Нет, спасибо</button>
            <button type="button" className={styles.main} onClick={() => onDessert(true)}>Да, напомните</button>
          </div>
        )}
      </div>
    );
  }
  return null;
}

function Who({ dish }) {
  return (
    <div className={styles.who}>
      <img src="/icons/foto-avatar.png" alt="" className={styles.avatar} />
      <span>{adviserLabel(dish)}</span>
    </div>
  );
}
