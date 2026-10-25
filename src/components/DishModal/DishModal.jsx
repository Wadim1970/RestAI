import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from './DishModal.module.css';
import { formatPrice, formatWeight } from '../../lib/menuFormat';
import CloseButton from '../CloseButton/CloseButton';
import { dishPhoto, dishThumb, fallbackToPhoto } from '../../lib/dishImage';

// Карточка блюда на весь экран: фото от края до края, поверх — название,
// цена и одна кнопка; описание, состав и КБЖУ — в стеклянной шторке по свайпу
// вверх. Свайп вбок — соседнее блюдо раздела (siblings), вниз — закрыть.
//
// Пропсы прежние (меню, корзина, голосовой помощник открывают как раньше), плюс
// необязательные:
//   siblings      — блюда раздела, по которым листать свайпом вбок;
//   onDishChange  — гость пролистал на другое блюдо;
//   pair          — { dish, lead, why } — «Шеф советует к этому»;
//   onRequestClose — закрыть с анимацией «обратно в карточку меню»; если нет,
//                    просто onClose после короткой анимации.
// overlayZIndex — как раньше: голосовой помощник открывает карточку поверх чата.

const SWIPE = 50;
const CLOSE_PULL = 90;

// Средний цвет картинки — поле для бутылок и маленьких фото. Если картинку
// нельзя прочитать (чужой сайт без CORS), остаётся тёмный по умолчанию.
function useImageColor(url, enabled) {
  const [color, setColor] = useState(null);
  useEffect(() => {
    if (!enabled || !url) return undefined;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 24; c.height = 24;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, 24, 24);
        const d = x.getImageData(0, 0, 24, 24).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue; // прозрачный фон вокруг бутылки не считаем
          const lum = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
          if (lum > 238) continue; // белый фон фотографии тоже
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
        if (!cancelled && n) {
          // Приглушаем и затемняем: на поле должен читаться белый текст.
          const k = 0.55;
          setColor(`rgb(${Math.round((r / n) * k)}, ${Math.round((g / n) * k)}, ${Math.round((b / n) * k)})`);
        }
      } catch { /* картинка с чужого сайта — canvas «испорчен», оставляем тёмный */ }
    };
    img.src = url;
    return () => { cancelled = true; };
  }, [url, enabled]);
  return enabled ? color : null;
}

// Состав метками — только если он «чистый» (короткие пункты без скобок).
// У части блюд состав разрезан на куски вроде «шашлык (свинина шея» — тогда
// показываем обычным текстом.
function ingredientsView(ingredients) {
  const list = Array.isArray(ingredients)
    ? ingredients.map((s) => String(s).trim()).filter(Boolean)
    : String(ingredients || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return null;
  const clean = list.every((s) => s.length <= 32 && !/[()]/.test(s));
  return clean ? { chips: list } : { text: list.join(', ') };
}

function kbjuOf(info) {
  if (!info || typeof info !== 'object') return null;
  const kcal = Number(info.calories_kcal), p = Number(info.protein_g), f = Number(info.fat_g), c = Number(info.carbs_g);
  if (![kcal, p, f, c].some((v) => v > 0)) return null;
  const grams = (p || 0) + (f || 0) + (c || 0) || 1;
  return [
    { v: kcal || 0, l: 'ккал', w: Math.min(100, (kcal || 0) / 10), c: 'var(--kbju-kcal)' },
    { v: p || 0, l: 'белки', w: ((p || 0) / grams) * 100, c: 'var(--kbju-p)' },
    { v: f || 0, l: 'жиры', w: ((f || 0) / grams) * 100, c: 'var(--kbju-f)' },
    { v: c || 0, l: 'углеводы', w: ((c || 0) / grams) * 100, c: 'var(--kbju-c)' },
  ];
}

// Свойства напитка из nutritional_info: «Крепость» — в строку с ценой, прочее
// (танины, полнота…) — строками в шторке. Служебные поля еды пропускаем.
const FOOD_KEYS = new Set(['calories_kcal', 'protein_g', 'fat_g', 'carbs_g', 'weight_value', 'weight_unit']);
function drinkSpecs(info) {
  if (!info || typeof info !== 'object') return { strength: null, rows: [] };
  let strength = null;
  const rows = [];
  for (const [k, v] of Object.entries(info)) {
    if (FOOD_KEYS.has(k) || v === null || v === '') continue;
    if (/крепост/i.test(k)) { strength = `${String(v).replace(/%$/, '')}%`; continue; }
    rows.push([k, String(v)]);
  }
  return { strength, rows };
}

export default function DishModal({
  isOpen, onClose, dish, currentCount = 0, updateCart, onOpenChat, overlayZIndex,
  siblings, onDishChange, pair, onRequestClose,
}) {
  // Состояние «по блюду»: при листании на другое блюдо шторка закрыта,
  // картинка грузится заново — без сброса в эффектах.
  const [expandedId, setExpandedId] = useState(null);
  const [closing, setClosing] = useState(false);
  const [img, setImg] = useState({ id: null, loaded: false, failed: false });
  const [slide, setSlide] = useState(0); // −1/1 — направление листания, для анимации
  const rootRef = useRef(null);
  const sheetRef = useRef(null);
  const headRef = useRef(null);
  const scrollRef = useRef(null);
  const closeBtnRef = useRef(null);
  const touch = useRef(null);
  const [peek, setPeek] = useState(240);

  const dishId = dish?.id;
  const expanded = !!dishId && expandedId === dishId;
  const setExpanded = (v) => setExpandedId((cur) => {
    const on = typeof v === 'function' ? v(cur === dishId) : v;
    return on ? dishId : null;
  });
  const imgNow = img.id === dishId ? img : { loaded: false, failed: false };
  const bigLoaded = imgNow.loaded;
  const bigFailed = imgNow.failed;
  const isDrink = dish && (dish.product_type === 'drink' || dish.product_type === 'alcohol');
  const isAlcohol = dish?.product_type === 'alcohol';
  const big = dishPhoto(dish);
  const thumb = dishThumb(dish);
  // Еда — всегда на весь экран. Напиток — крупно на поле цвета самой
  // картинки (бутылка без фона на чёрном выглядела бы потерянной).
  const fieldMode = isDrink;
  const field = useImageColor(thumb, !!(isOpen && fieldMode));

  const index = useMemo(() => (siblings && dish ? siblings.findIndex((d) => d.id === dish.id) : -1), [siblings, dish]);
  const total = siblings ? siblings.length : 0;

  useEffect(() => {
    if (!isOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => closeBtnRef.current?.focus({ preventScroll: true }), 50);
    return () => { document.body.style.overflow = prev; clearTimeout(t); };
  }, [isOpen]);

  // Высота «выглядывающей» шторки — по её шапке (название бывает в 1–3 строки).
  useLayoutEffect(() => {
    if (!isOpen || !headRef.current) return undefined;
    const measure = () => setPeek(headRef.current.offsetHeight + 112);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(headRef.current);
    return () => ro.disconnect();
  }, [isOpen, dishId]);

  const close = () => {
    if (closing) return;
    if (onRequestClose) { onRequestClose(); return; }
    setClosing(true);
    setTimeout(() => { onClose(); setClosing(false); }, 280);
  };

  const go = (dir) => {
    if (!siblings || index < 0) return;
    const next = siblings[index + dir];
    if (!next) {
      // Край раздела — лёгкий «отскок».
      setSlide(dir * 0.25);
      setTimeout(() => setSlide(0), 180);
      return;
    }
    setSlide(dir);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    onDishChange?.(next);
    setTimeout(() => setSlide(0), 20);
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { if (expanded) setExpanded(false); else close(); }
      if (!expanded && e.key === 'ArrowRight') go(1);
      if (!expanded && e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Жесты: вверх — шторка, вниз — закрыть (или свернуть шторку), вбок — соседнее блюдо.
  const onTouchStart = (e) => {
    const t = e.touches[0];
    const inScroll = scrollRef.current && scrollRef.current.contains(e.target);
    touch.current = { x: t.clientX, y: t.clientY, dx: 0, dy: 0, inScroll, scrollTop: scrollRef.current?.scrollTop || 0, axis: null };
  };
  const onTouchMove = (e) => {
    const s = touch.current;
    if (!s) return;
    const t = e.touches[0];
    s.dx = t.clientX - s.x;
    s.dy = t.clientY - s.y;
    if (!s.axis && (Math.abs(s.dx) > 8 || Math.abs(s.dy) > 8)) s.axis = Math.abs(s.dx) > Math.abs(s.dy) ? 'x' : 'y';
    // Пока шторка закрыта, тянем всю карточку вниз пальцем.
    if (s.axis === 'y' && !expanded && s.dy > 0 && rootRef.current) {
      rootRef.current.style.transform = `translateY(${s.dy * 0.6}px)`;
      rootRef.current.style.transition = 'none';
    }
  };
  const onTouchEnd = () => {
    const s = touch.current;
    touch.current = null;
    if (rootRef.current) { rootRef.current.style.transform = ''; rootRef.current.style.transition = ''; }
    if (!s || !s.axis) return;
    if (s.axis === 'x' && !expanded && Math.abs(s.dx) > SWIPE) { go(s.dx < 0 ? 1 : -1); return; }
    if (s.axis !== 'y') return;
    if (!expanded) {
      if (s.dy < -SWIPE) setExpanded(true);
      else if (s.dy > CLOSE_PULL) close();
      return;
    }
    // Шторка открыта: свернуть, если тянут вниз от самого верха текста.
    if (s.dy > SWIPE && (!s.inScroll || s.scrollTop <= 0)) setExpanded(false);
  };

  if (!isOpen || !dish) return null;

  const weight = formatWeight(dish);
  const kbju = isDrink ? null : kbjuOf(dish.nutritional_info);
  const ingredients = ingredientsView(dish.ingredients);
  const specs = isAlcohol ? drinkSpecs(dish.nutritional_info) : { strength: null, rows: [] };
  const cookTime = Number(dish.cook_time_min) > 0 ? `${dish.cook_time_min} мин` : null;
  const pairDish = pair?.dish;

  return (
    <div
      className={`${styles.overlay} ${closing ? styles.fadeOut : ''}`}
      style={overlayZIndex ? { zIndex: overlayZIndex } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={dish.dish_name}
    >
      <div
        ref={rootRef}
        className={`${styles.root} ${expanded ? styles.expanded : ''} ${closing ? styles.slideDown : ''}`}
        style={{ '--peek': `${peek}px`, '--field': field || 'var(--field-default)' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className={`${styles.hero} ${fieldMode ? styles.heroField : ''}`}
          style={{ transform: slide ? `translateX(${-slide * 6}%)` : undefined, opacity: Math.abs(slide) === 1 ? 0.4 : undefined }}
          onClick={() => expanded && setExpanded(false)}
        >
          {thumb && !fieldMode && (
            <img className={styles.placeholder} src={thumb} alt="" aria-hidden="true" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          )}
          {big && (
            <img
              key={big}
              className={`${styles.photo} ${bigLoaded ? styles.loaded : ''}`}
              src={bigFailed ? thumb : big}
              alt={dish.dish_name}
              style={{ viewTransitionName: 'dish-hero' }}
              onLoad={() => setImg({ id: dishId, loaded: true, failed: bigFailed })}
              onError={(e) => {
                if (!bigFailed && thumb && thumb !== big) setImg({ id: dishId, loaded: false, failed: true });
                else e.currentTarget.style.visibility = 'hidden';
              }}
            />
          )}
        </div>
        <div className={styles.scrim} />

        <div className={styles.top}>
          {total > 1 && index >= 0 && (
            total <= 8 ? (
              <div className={styles.dots} aria-label={`Блюдо ${index + 1} из ${total} в разделе`}>
                {siblings.map((d, i) => <i key={d.id} className={i === index ? styles.dotOn : ''} />)}
              </div>
            ) : (
              <div className={styles.counter}>{index + 1} / {total}</div>
            )
          )}
          <CloseButton ref={closeBtnRef} onClick={close} />
        </div>

        <div className={styles.sheet} ref={sheetRef}>
          <div className={styles.sheetIn} ref={scrollRef}>
            <button
              type="button"
              className={styles.grab}
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Свернуть подробности' : 'Подробнее о блюде'}
              aria-expanded={expanded}
            />
            <div ref={headRef}>
              <h2 className={styles.name}>{dish.dish_name}</h2>
              <div className={styles.meta}>
                <b>{formatPrice(dish.cost_rub)}</b>
                {weight && <span>{weight}</span>}
                {specs.strength && <span>· {specs.strength}</span>}
                {cookTime && <span>· {cookTime}</span>}
              </div>
              <button type="button" className={styles.more} onClick={() => setExpanded(true)}>Подробнее</button>
            </div>

            <div className={styles.details} aria-hidden={!expanded}>
              {isAlcohol ? (
                <>
                  {dish.description && <><h3 className={styles.dh}>О напитке</h3><p className={styles.dp}>{dish.description}</p></>}
                  {ingredients && <><h3 className={styles.dh}>Вкус</h3><p className={styles.dp}>{ingredients.chips ? ingredients.chips.join(', ') : ingredients.text}</p></>}
                  {specs.rows.length > 0 && (
                    <>
                      <h3 className={styles.dh}>Характеристики</h3>
                      <dl className={styles.specs}>
                        {specs.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                      </dl>
                    </>
                  )}
                </>
              ) : (
                <>
                  {dish.description && <><h3 className={styles.dh}>Описание</h3><p className={styles.dp}>{dish.description}</p></>}
                  {ingredients && (
                    <>
                      <h3 className={styles.dh}>Состав</h3>
                      {ingredients.chips
                        ? <div className={styles.chips}>{ingredients.chips.map((c) => <span key={c} className={styles.chip}>{c}</span>)}</div>
                        : <p className={styles.dp}>{ingredients.text}</p>}
                    </>
                  )}
                  {kbju && (
                    <>
                      <h3 className={styles.dh}>На порцию</h3>
                      <div className={styles.kbju}>
                        {kbju.map((k) => (
                          <div key={k.l} className={styles.k}>
                            <b>{k.v}</b><span>{k.l}</span>
                            <i style={{ '--w': `${k.w}%`, '--c': k.c }} />
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {pairDish && (
                <>
                  <h3 className={styles.dh}>Шеф советует к этому</h3>
                  <div className={styles.pair}>
                    <div className={styles.pairImg}>
                      {dishThumb(pairDish) && (
                        <img src={dishThumb(pairDish)} alt="" onError={fallbackToPhoto(pairDish)} />
                      )}
                    </div>
                    <div className={styles.pairText}>
                      <b>{pairDish.dish_name}</b>
                      <small>{pair.why}{pair.why ? ' · ' : ''}{formatPrice(pairDish.cost_rub)}</small>
                    </div>
                    {pair.inCart ? (
                      <span className={styles.pairDone} aria-label="Уже в заказе">✓</span>
                    ) : (
                      <button type="button" className={styles.pairAdd} onClick={() => updateCart(1, pairDish.id)} aria-label={`Добавить ${pairDish.dish_name}`}>+</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className={styles.cta}>
          <button type="button" className={styles.chatBtn} onClick={() => onOpenChat?.(dish)} aria-label="Спросить шефа-ИИ об этом блюде">
            <img src="/icons/foto-avatar.png" alt="" />
          </button>
          {dish.stopped && currentCount === 0 ? (
            <button type="button" className={styles.addBtn} disabled>
              Нет в наличии
            </button>
          ) : currentCount === 0 ? (
            <button type="button" className={styles.addBtn} onClick={() => updateCart(1, dish.id)}>
              Добавить · {formatPrice(dish.cost_rub)}
            </button>
          ) : (
            <div className={styles.stepper}>
              <button type="button" onClick={() => updateCart(-1, dish.id)} aria-label="Убрать одну порцию">−</button>
              <span>{currentCount}<small>{formatPrice((Number(dish.cost_rub) || 0) * currentCount)}</small></span>
              <button type="button" onClick={() => updateCart(1, dish.id)} disabled={dish.stopped} aria-label="Добавить ещё порцию">+</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
