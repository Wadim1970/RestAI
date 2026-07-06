import { useState } from 'react'
import RulesModal from '../RulesModal/RulesModal'
import styles from './InstallPromo.module.css'

const HIDE_KEY = 'restai_hide_install_promo'

export default function InstallPromo({ isIOS, isAndroid, canInstall, onInstallClick, onContinue }) {
  const [rulesOpen, setRulesOpen] = useState(false)
  const [neverAgain, setNeverAgain] = useState(false)
  // Chrome решает сам, когда прислать нативную подсказку (beforeinstallprompt) —
  // по внутренней эвристике вовлечённости, это не гарантировано даже на
  // технически готовой странице. Кнопка на Android поэтому есть ВСЕГДА: если
  // нативная подсказка подоспела — жмём её; если нет — показываем свой
  // запасной путь через меню самого браузера, который работает без условий.
  const [showManualAndroidHint, setShowManualAndroidHint] = useState(false)

  const handleContinue = () => {
    // На iOS факт установки из Safari не увидеть (изолированное хранилище) —
    // единственный способ отключить промо там - явный отказ пользователя.
    if (isIOS && neverAgain) {
      localStorage.setItem(HIDE_KEY, '1')
    }
    onContinue()
  }

  const handleAndroidClick = () => {
    if (canInstall) {
      onInstallClick()
    } else {
      setShowManualAndroidHint(true)
    }
  }

  return (
    <div className={styles.screen}>
      <img src="/icons/restai-512.png" alt="RestAI" className={styles.logo} />

      <h1 className={styles.title}>Установите приложение</h1>
      <p className={styles.motivation}>
        Установите наше приложение и копите баллы. Каждые 100 баллов —
        ужин на двоих за наш счёт, в любом из ресторанов с сервисом RestAI.
      </p>
      <button className={styles.rulesLink} onClick={() => setRulesOpen(true)}>
        Правила участия
      </button>

      {isAndroid && (
        <>
          <button className={styles.installBtn} onClick={handleAndroidClick}>
            Установить приложение
          </button>
          {showManualAndroidHint && (
            <div className={styles.iosHint}>
              <p className={styles.iosHintText}>
                Откройте меню браузера <MenuDotsIcon /> в правом верхнем углу
                и выберите «Установить приложение» (или «Добавить на главный экран»)
              </p>
            </div>
          )}
        </>
      )}

      {isIOS && (
        <div className={styles.iosHint}>
          <p className={styles.iosHintText}>
            Нажмите <ShareIcon /> внизу экрана, затем «На экран «Домой»
          </p>
        </div>
      )}

      <button className={styles.continueBtn} onClick={handleContinue}>
        Продолжить без установки
      </button>

      {isIOS && (
        <label className={styles.neverAgain}>
          <input
            type="checkbox"
            checked={neverAgain}
            onChange={(e) => setNeverAgain(e.target.checked)}
          />
          Больше не показывать
        </label>
      )}

      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </div>
  )
}

// Иконка "Поделиться" iOS (квадрат со стрелкой вверх) — узнаваемый визуальный
// ориентир, чтобы гость сразу нашёл нужную кнопку в Safari.
function ShareIcon() {
  return (
    <svg
      className={styles.shareIcon}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2v13M12 2l4 4M12 2L8 6M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Иконка "три точки" (меню браузера) — узнаваемый ориентир для Android,
// аналогично ShareIcon для iOS.
function MenuDotsIcon() {
  return (
    <svg
      className={styles.shareIcon}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  )
}

export { HIDE_KEY }
