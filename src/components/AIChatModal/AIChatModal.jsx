// src/components/AIChatModal/AIChatModal.jsx
import React, { useState } from 'react';
import styles from './AIChatModal.module.css';

const AIChatModal = ({ isOpen, onClose, viewHistory }) => {
  const [inputValue, setInputValue] = useState('');
  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      {/* Только стекло и поле ввода. КНОПОК ТУТ НЕТ! */}
      <div className={styles.glassContainer}>
        <div className={styles.chatHistory}>
          <div className={styles.botMessage}>Я вас слушаю...</div>
          {viewHistory && viewHistory.length > 0 && (
             <div className={styles.systemInfo}>Контекст: {viewHistory.join(', ')}</div>
          )}
        </div>

        <div className={styles.inputBlock}>
          <textarea 
            className={styles.textArea}
            placeholder="Вам помочь с выбором?"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
};

export default AIChatModal;
