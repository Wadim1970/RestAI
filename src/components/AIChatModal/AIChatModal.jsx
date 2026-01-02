// src/components/AIChatModal/AIChatModal.jsx
import React, { useState } from 'react';
import styles from './AIChatModal.module.css';
import ToggleChatButton from '../ToggleChatButton';
import MenuButton from '../MenuButton';

const AIChatModal = ({ isOpen, onClose, onModeToggle, viewHistory }) => {
  const [inputValue, setInputValue] = useState('');
  // Состояние для хранения сообщений самого чата
  const [messages, setMessages] = useState([
    { role: 'bot', text: 'Здравствуйте! Я вижу, вы интересовались некоторыми блюдами. Чем могу помочь?' }
  ]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      {/* 1. СТЕКЛО (сжимается под клавиатуру за счет dvh) */}
      <div className={styles.glassContainer}>
        
        {/* 2. ОБЛАСТЬ СООБЩЕНИЙ (сюда летит история) */}
        <div className={styles.chatHistory}>
          {messages.map((msg, index) => (
            <div key={index} className={msg.role === 'bot' ? styles.botMessage : styles.userMessage}>
              {msg.text}
            </div>
          ))}
          
          {/* Технический вывод истории просмотров (для теста, потом скроем) */}
          {viewHistory && viewHistory.length > 0 && (
            <div className={styles.systemInfo}>
              Контекст: вы смотрели {viewHistory.join(', ')}
            </div>
          )}
        </div>

        {/* 3. БЕЛЫЙ БЛОК (высота 190px, уходит вверх с клавиатурой) */}
        <div className={styles.inputBlock}>
          <textarea 
            className={styles.textArea}
            placeholder="Вам помочь с выбором?"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
          />
          {/* Отступ снизу внутри блока, чтобы текст не перекрывался кнопками */}
          <div style={{ height: '80px' }}></div>
        </div>
      </div>

      {/* 4. КНОПКИ (Пригвождены намертво к экрану, игнорируют всё) */}
      <div className="buttons-footer-fixed">
        <MenuButton onClick={onClose} />
        <ToggleChatButton onToggle={onModeToggle} />
      </div>
    </div>
  );
};

export default AIChatModal;
