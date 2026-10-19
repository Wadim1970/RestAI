import { Swiper, SwiperSlide } from 'swiper/react';
import { EffectCube, Autoplay } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/effect-cube';
import 'swiper/css/autoplay';
import styles from './VoiceDishSlider.module.css';
import CloseButton from '../CloseButton/CloseButton';
import { dishThumb, fallbackToPhoto } from '../../lib/dishImage';

function dishWeightLabel(dish) {
  const value = dish.nutritional_info?.weight_value;
  if (value) return `${value} г`;
  return dish.weight_g || null;
}

// Блюда, которые голосовой ассистент назвал во время разговора
// (show_dish_card в voice-relay). Набор приходит с сервера уже целиком и
// каждый раз заменяется полностью (при смене темы старые блюда не
// остаются) — поэтому ключуем Swiper по составу набора: новый набор =
// свежий Swiper с чистой инициализацией куба, без ручного slideTo и без
// риска, что cube+loop криво переварит смену слайдов на лету.
export default function VoiceDishSlider({ dishes, onDishTap, onClose }) {
  if (dishes.length === 0) return null;

  const setKey = dishes.map((d) => d.id).join(',');

  return (
    <div className={styles.wrapper}>
      <CloseButton className={styles.closeBtn} onClick={onClose} />

      <Swiper
        key={setKey}
        modules={[EffectCube, Autoplay]}
        effect="cube"
        grabCursor
        loop={dishes.length > 1}
        speed={800}
        cubeEffect={{ shadow: true, slideShadows: false, shadowOffset: 40, shadowScale: 1 }}
        autoplay={dishes.length > 1 ? { delay: 2600, disableOnInteraction: true } : false}
        className={styles.slider}
      >
        {dishes.map((dish) => (
          <SwiperSlide key={dish.id} onClick={() => onDishTap(dish)}>
            <img
              src={dishThumb(dish)}
              alt={dish.dish_name}
              onError={fallbackToPhoto(dish)}
            />
            <div className={styles.infoBar}>
              <div className={styles.infoLeft}>
                <p className={styles.dishName}>{dish.dish_name}</p>
                {dishWeightLabel(dish) && <span className={styles.dishWeight}>{dishWeightLabel(dish)}</span>}
              </div>
              <div className={styles.dishPrice}>{dish.cost_rub}₽</div>
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}
