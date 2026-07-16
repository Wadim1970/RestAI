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
      <button className={styles.closeBtn} onClick={onClose} aria-label="Закрыть">
        <img src="/icons/icon-on.png" alt="" />
      </button>

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
              src={dish.image_url_thumbnail || dish.image_url}
              alt={dish.dish_name}
              onError={(e) => {
                // Тот же приём, что уже есть в DishModal — thumbnail лежит
                // на облачном Supabase-проекте, который сейчас не отвечает,
                // источник (image_url) — на отдельном хостинге ресторана и
                // не затронут. Меняем src только один раз, не по кругу.
                if (e.target.src.includes(dish.image_url_thumbnail) && dish.image_url) {
                  e.target.src = dish.image_url;
                }
              }}
            />
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
