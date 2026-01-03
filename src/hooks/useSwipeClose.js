import { useRef } from 'react';

// Хук принимает функцию, которую нужно выполнить при свайпе (onClose)
export const useSwipeClose = (onClose) => {
  const touchStartY = useRef(0);
  const touchEndY = useRef(0);

  const onTouchStart = (e) => {
    touchEndY.current = 0;
    touchStartY.current = e.targetTouches[0].clientY;
  };

  const onTouchMove = (e) => {
    touchEndY.current = e.targetTouches[0].clientY;
  };

  const onTouchEnd = () => {
    // Расстояние свайпа вниз
    const distance = touchEndY.current - touchStartY.current;
    // Если пролистали вниз больше 100px
    if (distance > 100 && touchEndY.current !== 0) {
      onClose();
    }
  };

  return { onTouchStart, onTouchMove, onTouchEnd };
};
