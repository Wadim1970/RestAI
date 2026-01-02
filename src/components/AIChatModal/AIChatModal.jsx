import React, { useState, useEffect } from 'react';
import styles from './AIChatModal.module.css';

const AIChatModal = ({ isOpen, onClose }) => {
  const [inputValue, setInputValue] = useState('');

  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      {/* Контейнер чата (Стекло) */}
      <div className={styles.glassContainer}>
        
        {/* Область сообщений (место для переписки) */}
        <div className={styles.chatHistory}>
          <div className={styles.botMessage}>
            Чем я могу вам помочь?
          </div>
        </div>

        {/* Блок ввода текста (Белый, 190px) */}
        <div className={styles.inputBlock}>
          <textarea 
            className={styles.textArea}
            placeholder="Напишите ваш вопрос..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          
          {/* Нижняя часть блока ввода с кнопками */}
          <div className={styles.inputActions}>
            <button className={styles.menuBtn} onClick={onClose}>
              <div className={styles.menuIcon}><span></span><span></span><span></span><span></span></div>
              Открыть меню
            </button>
            
            <div className={styles.modeIcons}>
              <button className={styles.iconBtn}><img src="/icons/volume.svg" alt="audio" /></button>
              <button className={`${styles.iconBtn} ${styles.activeIcon}`}><img src="/icons/chat-dots.svg" alt="text" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIChatModal;
