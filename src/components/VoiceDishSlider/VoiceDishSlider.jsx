import { useEffect, useRef } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { EffectCube, Autoplay } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/effect-cube';
import 'swiper/css/autoplay';
import styles from './VoiceDishSlider.module.css';

function dishWeightLabel(dish) {
  const value = dish.nutritional_info?.weight_value;
  if (value) return `${value} г`;
  return dish.weight_g || null;
}

// Блюда, которые голосовой ассистент назвал во время разговора
// (show_dish_card/hide_dish_card, состояние живёт в VoiceStage — см. его
// комментарий про "здесь будут выезжать карточки блюд"). Вращение куба —
// не только даёт понять, что карточки можно листать вручную, но и само
// поворачивается к новому блюду ровно в момент, когда ИИ начинает о нём
// говорить (см. эффект ниже, ключ — id последнего элемента массива).
export default function VoiceDishSlider({ dishes, onDishTap, onClose }) {
  const swiperRef = useRef(null);
  const lastDishId = dishes[dishes.length - 1]?.id;

  useEffect(() => {
    if (!swiperRef.current || lastDishId == null) return;
    const index = dishes.findIndex((d) => d.id === lastDishId);
    if (index >= 0) swiperRef.current.slideTo(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDishId]);

  if (dishes.length === 0) return null;

  return (
    <div className={styles.wrapper}>
      <button className={styles.closeBtn} onClick={onClose} aria-label="Закрыть">
        <img src="/icons/icon-on.png" alt="" />
      </button>

      <Swiper
        modules={[EffectCube, Autoplay]}
        effect="cube"
        grabCursor
        loop={dishes.length > 1}
        speed={800}
        cubeEffect={{ shadow: true, slideShadows: false, shadowOffset: 40, shadowScale: 1 }}
        autoplay={dishes.length > 1 ? { delay: 2600, disableOnInteraction: true } : false}
        onSwiper={(instance) => { swiperRef.current = instance; }}
        className={styles.slider}
      >
        {dishes.map((dish) => (
          <SwiperSlide key={dish.id} onClick={() => onDishTap(dish)}>
            <img src={dish.image_url_thumbnail || dish.image_url} alt={dish.dish_name} />
            <div className={styles.infoBar}>
              <p>{dish.dish_name}</p>
              <span>
                {dish.cost_rub}₽{dishWeightLabel(dish) ? ` · ${dishWeightLabel(dish)}` : ''}
              </span>
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}
