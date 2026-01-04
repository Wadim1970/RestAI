import React, { useState } from 'react';
import styles from './AIControlCenter.module.css'; // Используем те же классы

const TextView = ({ onSwitchToVideo, viewHistory }) => {
  const [inputValue, setInputValue] = useState('');

  // Логика кнопки справа (Голос / Отправить)
  const handleAction = () => {
    if (inputValue.trim().length > 0) {
      // Если текст есть — имитируем отправку (сюда потом подключим useChatApi)
      console.log("Отправлено:", inputValue);
      setInputValue(''); 
    } else {
      // Если текста нет — переключаем на видео-режим (как ты и просил)
      onSwitchToVideo(); 
    }
  };

  return (
    <div className={styles['modal-glassContainer']}>
      {/* История чата */}
      <div className={styles['modal-chatHistory']}>
        <div className={styles['modal-botMessage']}>Вам помочь с выбором?</div>
      </div>

      {/* Футер с вводом текста */}
      <div className={styles['modal-footerControls']}>
        <div className={styles['modal-inputWrapper']}>
          {/* Твоя иконка меню слева в инпуте */}
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

        {/* Твоя кнопка действия (Зеленая, справа от инпута) */}
        <button className={styles['modal-actionButton']} onClick={handleAction}>
          {inputValue.trim().length > 0 ? (
            <img src="/icons/free-icon-start.png" className={styles['modal-iconSend']} alt="Отправить" />
          ) : (
            <img src="/icons/free-icon-audio.png" className={styles['modal-iconAudio']} alt="Голос" />
          )}
        </button>
      </div>
    </div>
  );
};

export default TextView;
