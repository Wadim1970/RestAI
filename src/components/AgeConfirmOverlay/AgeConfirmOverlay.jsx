import styles from './AgeConfirmOverlay.module.css';

// Оверлей для гостя, заказавшего алкоголь: пока официант не подтвердит
// возраст, заказ на кухню не уходит.
//   status='waiting'  — ждём решения официанта (крутилка + «Отменить»);
//   status='declined' — официант отказал, нужно убрать алкоголь из корзины.
export default function AgeConfirmOverlay({ status, onCancelWaiting, onDismissDeclined }) {
  if (status !== 'waiting' && status !== 'declined') return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        {status === 'waiting' ? (
          <>
            <div className={styles.icon} aria-hidden="true">🍷</div>
            <h2 className={styles.title}>Подтверждение возраста</h2>
            <p className={styles.text}>
              В вашем заказе есть алкоголь. Официант подойдёт подтвердить ваш
              возраст — пожалуйста, подождите.
            </p>
            <div className={styles.spinner} aria-hidden="true" />
            <button className={styles.linkBtn} onClick={onCancelWaiting}>
              Отменить
            </button>
          </>
        ) : (
          <>
            <div className={styles.icon} aria-hidden="true">🔞</div>
            <h2 className={styles.title}>Возраст не подтверждён</h2>
            <p className={styles.text}>
              Официант не подтвердил ваш возраст. Уберите, пожалуйста, алкоголь
              из заказа и оформите его заново.
            </p>
            <button className={styles.primaryBtn} onClick={onDismissDeclined}>
              Понятно
            </button>
          </>
        )}
      </div>
    </div>
  );
}
