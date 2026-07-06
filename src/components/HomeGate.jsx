import { useState } from 'react'
import MainScreen from './MainScreen.jsx'
import InstallPromo, { HIDE_KEY } from './InstallPromo/InstallPromo.jsx'
import GuestScanner from './GuestScanner/GuestScanner.jsx'
import { useDisplayMode, isIOSDevice } from '../hooks/useDisplayMode.js'
import { useInstallPrompt } from '../hooks/useInstallPrompt.js'

// Решает, какой из трёх экранов входа показать: сканер (стол ещё не
// известен — актуально для уже установленного приложения, запуск с иконки
// не несёт ссылку со столом), промо установки (браузер, стол уже известен)
// или сразу стартовый экран с видео (установлено, или промо уже отклонили).
export default function HomeGate({ restaurantId, tableNumber, onScanned, onChatModeToggle, isChatOpen }) {
  const isStandalone = useDisplayMode()
  const isIOS = isIOSDevice()
  const { canInstall, promptInstall } = useInstallPrompt()

  // Сбрасывается при каждой новой загрузке страницы — промо снова покажется
  // "при каждом заходе, пока не установит", как и договаривались. Постоянный
  // отказ ("Больше не показывать") — только явным чекбоксом на iOS, в
  // localStorage, т.к. факт установки там из браузера не увидеть.
  const [dismissedThisVisit, setDismissedThisVisit] = useState(false)
  const iosHiddenForever = isIOS && localStorage.getItem(HIDE_KEY) === '1'

  if (!tableNumber) {
    return <GuestScanner onScanned={onScanned} />
  }

  if (!isStandalone && !dismissedThisVisit && !iosHiddenForever) {
    return (
      <InstallPromo
        isIOS={isIOS}
        canInstall={canInstall}
        onInstallClick={async () => {
          await promptInstall()
          setDismissedThisVisit(true)
        }}
        onContinue={() => setDismissedThisVisit(true)}
      />
    )
  }

  return <MainScreen onChatModeToggle={onChatModeToggle} isChatOpen={isChatOpen} />
}
