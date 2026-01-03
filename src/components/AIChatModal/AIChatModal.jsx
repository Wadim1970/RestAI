// src/components/AIChatModal/AIChatModal.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom'; // Для перехода на страницу меню
import styles from './AIChatModal.module.css';

const AIChatModal = ({ isOpen, onClose, viewHistory }) => {
  const [inputValue, setInputValue] = useState(''); // Состояние текста в поле
  const navigate = useNavigate(); // Хук для навигации

  // Если модалка закрыта, ничего не рендерим
  if (!isOpen) return null;

  // Функция обработки кнопки справа
  const handleAction = () => {
    if (inputValue.trim().length > 0) {
      // ЕСЛИ ЕСТЬ ТЕКСТ: Логика отправки
      console.log("Отправка сообщения:", inputValue);
      setInputValue(''); // Очищаем поле после отправки
    } else {
      // ЕСЛИ ТЕКСТА НЕТ: Закрываем чат (возврат к видео)
      onClose();
    }
  };

  // Функция перехода в меню
  const goToMenu = () => {
    onClose(); // Закрываем модалку
    navigate('/menu'); // Переходим по адресу /menu
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.glassContainer}>
        
        {/* Блок истории сообщений */}
        <div className={styles.chatHistory}>
          <div className={styles.botMessage}>Вам помочь с выбором блюд и напитков?</div>
          {/* Вывод контекста страниц, которые посетил юзер */}
          {viewHistory && viewHistory.length > 0 && (
            <div className={styles.systemInfo}>Контекст: {viewHistory.join(', ')}</div>
          )}
        </div>

        {/* Нижняя панель с кнопками и вводом */}
        <div className={styles.footerControls}>
          
          {/* Контейнер текстового поля */}
          <div className={styles.inputWrapper}>
            {/* Иконка Меню (Слева внутри поля) */}
            <img 
              src="/icons/menu-icon.png" // Замени на свое имя файла иконки меню
              className={styles.menuInInput} 
              onClick={goToMenu} 
              alt="Menu" 
            />
            {/* Сама область ввода */}
            <textarea 
              className={styles.textArea}
              placeholder="Вам помочь с выбором?"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              autoFocus
            />
          </div>

          {/* Правая круглая кнопка (Динамическая) */}
          <button 
            className={styles.actionButton} 
            onClick={handleAction}
          >
            {inputValue.trim().length > 0 ? (
              /* Иконка отправки, если текст введен (24x28px) */
              <img src="/icons/free-icon-start.png" className={styles.iconSend} alt="Send" />
            ) : (
              /* Иконка аудио, если поле пустое (40x35px) */
              <img src="/icons/free-icon-audio.png" className={styles.iconAudio} alt="Audio" />
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default AIChatModal;
