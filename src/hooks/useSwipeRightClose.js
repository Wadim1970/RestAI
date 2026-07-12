import { useRef } from 'react';

// Зеркало useSwipeLeftOpen: тот же порог, но противоположное
// направление и назначение — закрывает уже открытую панель личного
// кабинета свайпом вправо (в дополнение к кнопке ✕).
const SWIPE_THRESHOLD = 80;

export const useSwipeRightClose = (onClose) => {
  const touchStartX = useRef(0);

  const onTouchStart = (e) => {
    touchStartX.current = e.targetTouches[0].clientX;
  };

  const onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx > SWIPE_THRESHOLD) onClose();
  };

  return { onTouchStart, onTouchEnd };
};
