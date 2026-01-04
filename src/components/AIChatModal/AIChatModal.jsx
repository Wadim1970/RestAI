import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom'; // Импортируем хук навигации
import styles from './AIChatModal.module.css';

const AIChatModal = ({ isOpen, onClose, onModeToggle }) => {
  const [inputValue, setInputValue] = useState('');
  const navigate = useNavigate(); // Инициализируем навигацию

  if (!isOpen) return null;

  /**
   * ГЛАВНАЯ ФУНКЦИЯ КНОПКИ ДЕЙСТВИЯ (Зеленая кнопка справа)
   */
  const handleActionClick = () => {
    // ПРОВЕРКА: Если пользователь ввел текст
    if (inputValue.trim().length > 0) {
      // Логика отправки сообщения
      console.log("Отправка сообщения:", inputValue);
      setInputValue(''); 
    } else {
      // ЕСЛИ ПОЛЕ ПУСТОЕ: Переключаем режим на видео-чат
      
      // 1. Закрываем модальное окно (через функцию из App.js)
      if (onModeToggle) {
        onModeToggle('voice'); // Передаем режим 'voice', что сделает isChatOpen(false)
      } else {
        onClose();
      }

      // 2. ВСЕГДА перенаправляем пользователя на главную страницу к видео
      navigate('/'); 
    }
  };

  return (
    <div className={styles['modal-overlay']}>
      <div className={styles['modal-glassContainer']}>
        
        {/* Кнопка закрытия (крестик) — просто закрывает чат, не меняя страницу */}
        <button className={styles['modal-closeBtn']} onClick={onClose}>
          <img src="/icons/icon-on.png" alt="Закрыть" />
        </button>

        <div className={styles['modal-chatHistory']}>
          <div className={styles['modal-botMessage']}>
            Чем я могу вам помочь?
          </div>
        </div>

        <div className={styles['modal-footerControls']}>
          <div className={styles['modal-inputWrapper']}>
            {/* Иконка меню внутри поля (оставляем как декоративную или для других целей) */}
            <img 
              src="/icons/free-icon-main-menu-2.png" 
              className={styles['modal-menuInInput']} 
              alt="Меню" 
            />
            
            <textarea 
              className={styles['modal-textArea']}
              placeholder="Напишите сообщение..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>

          {/* ТА САМАЯ ЗЕЛЕНАЯ КНОПКА */}
          <button 
            className={styles['modal-actionButton']} 
            onClick={handleActionClick} // Привязываем новую логику
          >
            {inputValue.trim().length > 0 ? (
              /* Иконка отправки, если текст есть */
              <img src="/icons/free-icon-start.png" className={styles['modal-iconSend']} alt="Отправить" />
            ) : (
              /* Иконка аудио, если текста нет — ТЕПЕРЬ ОНА ВЕДЕТ НА ГЛАВНУЮ */
              <img src="/icons/free-icon-audio.png" className={styles['modal-iconAudio']} alt="К видео-аватару" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatModal;
