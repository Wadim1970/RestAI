// src/components/AIChatModal/AIChatModal.jsx
import React, { useState } from 'react';
import styles from './AIChatModal.module.css';
import ToggleChatButton from '../ToggleChatButton';
import MenuButton from '../MenuButton';

const AIChatModal = ({ isOpen, onClose, onModeToggle }) => {
  const [inputValue, setInputValue] = useState('');

  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      {/* 1. СТЕКЛО (отступ 6px от экрана) */}
      <div className={styles.glassContainer}>
        
        {/* 2. ИСТОРИЯ ЧАТА */}
        <div className={styles.chatHistory}>
          <div className={styles.botMessage}>Я слушаю, напишите ваш вопрос...</div>
        </div>

        {/* 3. БЕЛЫЙ БЛОК (высота 190px, отступ 6px от стекла) */}
        <div className={styles.inputBlock}>
          <textarea 
            className={styles.textArea}
            placeholder="Вам помочь с выбором?"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
          />

          {/* 4. ТВОИ РОДНЫЕ КНОПКИ ПОВЕРХ БЕЛОГО БЛОКА */}
          {/* Мы используем className="buttons-footer" БЕЗ добавления стилей в CSS модули, 
              чтобы подхватились твои глобальные стили из styles.css */}
          <div className="buttons-footer" style={{ position: 'absolute', bottom: '25px', left: '20px', right: '20px', zIndex: 100 }}>
             <MenuButton onClick={onClose} />
             <ToggleChatButton onToggle={onModeToggle} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIChatModal;
