import { useRef } from 'react';

// Тот же порог и логика, что уже используется в Waiter-app для свайпа
// между экранами (80px по X, без учёта оси Y — вертикальный скролл
// меню не мешает сработать свайпу).
const SWIPE_THRESHOLD = 80;

export const useSwipeLeftOpen = (onOpen) => {
  const touchStartX = useRef(0);

  const onTouchStart = (e) => {
    touchStartX.current = e.targetTouches[0].clientX;
  };

  const onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -SWIPE_THRESHOLD) onOpen();
  };

  return { onTouchStart, onTouchEnd };
};
