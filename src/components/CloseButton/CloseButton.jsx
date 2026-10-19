import styles from './CloseButton.module.css';

// Единая кнопка закрытия окон — «стеклянный» круг с крестиком, как в
// карточке блюда (DishModal). Положение задаёт окно через className.
export default function CloseButton({ onClick, className = '', label = 'Закрыть', ref }) {
  return (
    <button
      ref={ref}
      type="button"
      className={className ? `${styles.closeBtn} ${className}` : styles.closeBtn}
      onClick={onClick}
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </button>
  );
}
