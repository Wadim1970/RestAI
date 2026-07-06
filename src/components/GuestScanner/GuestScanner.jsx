import { useEffect, useRef, useState } from 'react'
import styles from './GuestScanner.module.css'

// Внутренняя камера нужна только когда стол ещё не известен — то есть
// приложению уже установленному (запуск с иконки не несёт ссылку со
// столом). При обычном скане QR родной камерой телефона стол приходит
// прямо в URL, и этот экран вообще не показывается.
//
// Гонка со stream — тот же баг и тот же фикс, что и в сканере официанта:
// async-старт камеры может подняться уже после ухода с экрана и повиснуть
// включённым, если не проверить это явно.
export default function GuestScanner({ onScanned }) {
  const videoRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let stopped = false
    let controls = null

    const startScanner = async () => {
      try {
        const { BrowserQRCodeReader, BrowserCodeReader } = await import('@zxing/browser')

        const codeReader = new BrowserQRCodeReader()
        const videoInputDevices = await BrowserCodeReader.listVideoInputDevices()
        const backCamera =
          videoInputDevices.find(
            (d) =>
              d.label.toLowerCase().includes('back') ||
              d.label.toLowerCase().includes('rear') ||
              d.label.toLowerCase().includes('environment')
          ) ?? videoInputDevices[videoInputDevices.length - 1]

        controls = await codeReader.decodeFromVideoDevice(
          backCamera?.deviceId,
          videoRef.current,
          (result) => {
            if (stopped || !result) return
            stopped = true
            controls?.stop()
            handleScan(result.getText())
          }
        )
        // Экран мог размонтироваться, пока камера ещё поднималась —
        // тогда cleanup уже отработал с ещё пустым controls, и поток
        // остался бы висеть включённым, если не заглушить его здесь.
        if (stopped) controls.stop()
      } catch {
        setError('Не удалось запустить камеру. Проверьте разрешения.')
      }
    }

    startScanner()
    return () => {
      stopped = true
      controls?.stop()
    }
  }, [])

  const handleScan = (decodedText) => {
    setError(null)
    try {
      const url = new URL(decodedText)
      const restaurantId = url.searchParams.get('restaurant_id')
      const table = url.searchParams.get('table')
      if (!restaurantId || !table) {
        setError('QR-код стола не распознан. Попробуйте ещё раз.')
        return
      }
      onScanned(restaurantId, table)
    } catch {
      setError('QR-код не распознан. Попробуйте ещё раз.')
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>Сканируйте QR-код на столе</h1>
      </div>

      <div className={styles.body}>
        <div className={styles.viewfinder}>
          <video ref={videoRef} className={styles.video} />
          <div className={styles.overlay}>
            <div className={styles.corner} />
          </div>
        </div>

        {error && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{error}</p>
            <button className={styles.retryBtn} onClick={() => window.location.reload()}>
              Попробовать снова
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
