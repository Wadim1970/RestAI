import React, { useState } from 'react';
import styles from './AIChatModal.module.css';

const AIChatModal = ({ isOpen, onClose }) => {
  const [inputValue, setInputValue] = useState('');
  const [viewMode, setViewMode] = useState('text'); // 'text' или 'video'

  if (!isOpen) return null;

 
  const handleActionClick = () => {
    if (inputValue.trim().length > 0) {
      // Здесь будет sendMessage(inputValue)
      console.log("Отправка:", inputValue);
      setInputValue(''); 
    } else {
      // ПЕРЕКЛЮЧЕНИЕ: если пусто, меняем режим
      setViewMode(prev => prev === 'text' ? 'video' : 'text');
    }
  };

  return (
    <div className={styles['modal-overlay']}>
      <div className={styles['modal-glassContainer']}>
        
        {/* КРЕСТИК */}
        <button className={styles['modal-closeBtn']} onClick={onClose}>
          <img src="/icons/icon-on.png" alt="Закрыть" />
        </button>

        {/* --- КОНТЕНТНАЯ ОБЛАСТЬ --- */}
        <div className={styles['modal-chatHistory']}>
          {viewMode === 'text' ? (
            // 1. ТЕКСТОВЫЙ ЧАТ
            <div className={styles['modal-botMessage']}>
              Чем я могу вам помочь?
            </div>
          ) : (
            // 2. ЗАГЛУШКА ПОД ВИДЕО-АВАТАР
            <div 
              style={{ 
                width: '100%', 
                height: '100%', 
                background: '#000', // Черный фон под видео
                borderRadius: '20px', 
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              <span style={{ color: '#48BF48', fontSize: '14px', opacity: 0.6 }}>
                [ ПОДКЛЮЧЕНИЕ ВИДЕО-АВАТАРА... ]
              </span>
              {/* Позже сюда вставим <video id="avatar-video" /> */}
            </div>
          )}
        </div>

        {/* --- ПАНЕЛЬ ВВОДА --- */}
        <div className={styles['modal-footerControls']}>
          <div className={styles['modal-inputWrapper']}>
            <img src="/icons/free-icon-main-menu-2.png" className={styles['modal-menuInInput']} alt="Menu" />
            <textarea 
              className={styles['modal-textArea']}
              placeholder={viewMode === 'text' ? "Напишите сообщение..." : "Слушаю вас..."}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>

          <button className={styles['modal-actionButton']} onClick={handleActionClick}>
            {inputValue.trim().length > 0 ? (
              <img src="/icons/free-icon-start.png" className={styles['modal-iconSend']} alt="Send" />
            ) : (
              // Динамическая смена иконки: если в видео — иконка чата, если в чате — микрофон
              <img 
                src={viewMode === 'text' ? "/icons/free-icon-audio.png" : "/icons/free-icon-chat.png"} 
                className={styles['modal-iconAudio']} 
                alt="Switch" 
              />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatModal;
