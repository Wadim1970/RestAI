import styles from './RulesModal.module.css'

// Заглушка — реальный текст правил программы лояльности добавим позже.
export default function RulesModal({ onClose }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Правила участия</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <p className={styles.text}>
          Здесь будут подробные правила программы лояльности RestAI — как
          начисляются и списываются баллы, ограничения и условия. Раздел
          в разработке.
        </p>
      </div>
    </div>
  )
}
