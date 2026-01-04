import React, { useState } from 'react';
import { useChatApi } from './useChatApi'; // Твоя логика связи с n8n
import styles from './AIControlCenter.module.css'; // Твой восстановленный CSS

const TextView = ({ onSwitchToVideo, viewHistory }) => {
  const [inputValue, setInputValue] = useState('');
  
  // Подключаем функционал из твоего useChatApi
  // Предполагаем, что он возвращает массив сообщений и функцию отправки
  const { messages, sendMessage, isLoading } = useChatApi(viewHistory);

  /**
   * ГЛАВНАЯ ЛОГИКА ТВОЕЙ ЗЕЛЕНОЙ КНОПКИ
   */
  const handleActionClick = () => {
    if (inputValue.trim().length > 0) {
      // 1. Если текст есть — отправляем через n8n
      if (sendMessage) {
        sendMessage(inputValue);
      }
      setInputValue(''); // Очищаем поле после отправки
    } else {
      // 2. Если поле ПУСТОЕ — переключаем на видео-аватара (как ты просил)
      onSwitchToVideo();
    }
  };

  return (
    <div className={styles['modal-glassContainer']}>
      
      {/* ИСТОРИЯ ЧАТА (ТВОЙ ОРИГИНАЛЬНЫЙ БЛОК) */}
      <div className={styles['modal-chatHistory']}>
        {/* Сообщение-приветствие по умолчанию */}
        <div className={styles['modal-botMessage']}>
          Чем я могу вам помочь?
        </div>

        {/* Рендер сообщений из API n8n (если они есть) */}
        {messages && messages.map((msg, index) => (
          <div 
            key={index} 
            className={msg.role === 'assistant' ? styles['modal-botMessage'] : styles['modal-userMessage']}
          >
            {msg.content}
          </div>
        ))}

        {/* Индикатор загрузки ответа */}
        {isLoading && <div className={styles['modal-botMessage']}>...</div>}
      </div>

      {/* ФУТЕР (ТВОЯ ОРИГИНАЛЬНАЯ ПАНЕЛЬ ВВОДА) */}
      <div className={styles['modal-footerControls']}>
        <div className={styles['modal-inputWrapper']}>
          {/* Иконка меню внутри текстового поля */}
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

        {/* ТВОЯ ЗЕЛЕНАЯ КНОПКА (СПРАВА) */}
        <button 
          className={styles['modal-actionButton']} 
          onClick={handleActionClick}
        >
          {inputValue.trim().length > 0 ? (
            /* Иконка отправки (стрелочка), если текст набран */
            <img src="/icons/free-icon-start.png" className={styles['modal-iconSend']} alt="Отправить" />
          ) : (
            /* Иконка аудио (микрофон), если поле пустое — ведет в Видео-режим */
            <img src="/icons/free-icon-audio.png" className={styles['modal-iconAudio']} alt="К видео-аватару" />
          )}
        </button>
      </div>
    </div>
  );
};

export default TextView;
