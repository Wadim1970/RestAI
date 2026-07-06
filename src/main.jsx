import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />  {/* ← HashRouter и ThemeProvider уже внутри App */}
  </StrictMode>,
)

// Регистрация SW нужна для installability на Android (критерий "Установить
// приложение" в Chrome требует зарегистрированный service worker).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Не удалось зарегистрировать service worker:', err)
    })
  })
}
