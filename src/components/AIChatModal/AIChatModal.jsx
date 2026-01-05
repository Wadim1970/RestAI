import React, { useState, useRef, useEffect } from 'react'; // Импорт React и хуков
import styles from './AIChatModal.module.css'; // Импорт стилей

const AIChatModal = ({ isOpen, onClose }) => {
  const [inputValue, setInputValue] = useState(''); // Стейт для текста
  const [viewMode, setViewMode] = useState('text'); // Режим: 'text' (чат) или 'video' (аватар)
  const textAreaRef = useRef(null); // Реф для авто-высоты текстового поля

  // Эффект для динамического изменения высоты текстового поля (рост вверх)
  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.style.height = 'auto'; // Сброс
      textAreaRef.current.style.height = Math.min(textAreaRef.current.scrollHeight, 150) + 'px'; // Установка новой высоты
    }
  }, [inputValue]);

  if (!isOpen) return null; // Если модалка закрыта — не рендерим ничего

  // Логика кнопки действия (отправка или переключение режима)
  const handleActionClick = () => {
    if (inputValue.trim().length > 0) {
      console.log("Отправка сообщения:", inputValue);
      setInputValue(''); // Очистка после отправки
    } else {
      // Если текста нет — переключаемся на видео (или обратно)
      setViewMode(prev => prev === 'text' ? 'video' : 'text');
    }
  };

  return (
    <div className={styles['modal-overlay']}>
      <div className={styles['modal-glassContainer']}>
        
        {/* --- КНОПКИ ПОВЕРХ КОНТЕНТА --- */}
        
        {/* Кнопка закрытия (Крестик) - Всегда справа сверху */}
        <button className={styles['modal-closeBtn']} onClick={onClose}>
          <img src="/icons/icon-on.png" alt="Закрыть" />
        </button>

        {/* Зеленая кнопка возврата в текстовый режим - Показывается только в видео-режиме слева */}
        {viewMode === 'video' && (
          <button 
            className={styles['modal-switchToTextBtn']} 
            onClick={() => setViewMode('text')}
          >
            {/* Используем иконку чата для возврата */}
            <img src="/icons/free-icon-chat.png" alt="В чат" />
          </button>
        )}

        {/* --- ОСНОВНАЯ ОБЛАСТЬ --- */}
        <div className={`${styles['modal-chatHistory']} ${viewMode === 'video' ? styles['videoActive'] : ''}`}>
          {viewMode === 'text' ? (
            // РЕЖИМ ЧАТА
            <div className={styles['modal-botMessage']}>
              Чем я могу вам помочь?
            </div>
          ) : (
            // РЕЖИМ ВИДЕО (Full Screen)
            <div className={styles['videoWrapper']}>
              <div className={styles['videoPlaceholder']}>
                <span className={styles['statusText']}>[ ОЖИДАНИЕ ПОТОКА АВАТАРА... ]</span>
              </div>
              {/* Сюда в будущем вставится <video /> от любого SDK (HeyGen/D-ID) */}
            </div>
          )}
        </div>

        {/* --- ПАНЕЛЬ ВВОДА --- */}
        {/* Показываем её только в текстовом режиме, чтобы видео было чистым */}
        {viewMode === 'text' && (
          <div className={styles['modal-footerControls']}>
            <div className={styles['modal-inputWrapper']}>
              <textarea 
                ref={textAreaRef}
                className={styles['modal-textArea']}
                rows="1"
                placeholder="Напишите сообщение..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
            </div>
            <button className={styles['modal-actionButton']} onClick={handleActionClick}>
              <img 
                src={inputValue.trim().length > 0 ? "/icons/free-icon-start.png" : "/icons/free-icon-audio.png"} 
                className={styles['modal-iconSend']} 
                alt="Action" 
              />
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default AIChatModal;
