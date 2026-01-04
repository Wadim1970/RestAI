import React, { useState } from 'react';
import styles from './AIControlCenter.module.css';

const TextView = ({ onSwitchToVideo }) => {
  const [inputValue, setInputValue] = useState('');

  const handleAction = () => {
    if (inputValue.trim()) {
      console.log("Отправка в чат:", inputValue);
      setInputValue('');
    } else {
      onSwitchToVideo(); // Переключаемся на видео, если поле пустое
    }
  };

  return (
    <div className={styles.contentWrapper}>
      <div className={styles.chatHistory}>
        <div className={styles.botMessage}>Я слушаю! Можете написать или перейти в видео-режим.</div>
      </div>
      <div className={styles.inputArea}>
        <textarea 
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Напишите вопрос..."
        />
        <button onClick={handleAction} className={styles.actionBtn}>
          <img src={inputValue.trim() ? "/icons/free-icon-start.png" : "/icons/free-icon-audio.png"} alt="action" />
        </button>
      </div>
    </div>
  );
};

export default TextView;
