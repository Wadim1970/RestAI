import React, { useState } from 'react';
import styles from './AIChatModal.module.css';
import ToggleChatButton from '../ToggleChatButton';
import MenuButton from '../MenuButton';

const AIChatModal = ({ isOpen, onClose, onModeToggle }) => {
  const [inputValue, setInputValue] = useState('');

  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      {/* 1. Стеклянный фон (отступы по 6px реализованы в CSS через padding у overlay) */}
      <div className={styles.glassContainer}>
        
        {/* 2. История чата */}
        <div className={styles.chatHistory}>
          <div className={styles.botMessage}>Чем я могу помочь?</div>
        </div>

        {/* 3. Белый блок (высота 190px) */}
        <div className={styles.inputBlock}>
          <textarea 
            className={styles.textArea}
            placeholder="Вам помочь с выбором блюд?"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      {/* 4. ТВОИ КНОПКИ ПОВЕРХ ВСЕГО */}
      {/* Используем тот же класс, что и на главном экране, чтобы они не сдвинулись ни на пиксель */}
      <div className="buttons-footer" style={{ z-index: 100000 }}>
        <MenuButton onClick={onClose} />
        <ToggleChatButton onToggle={onModeToggle} />
      </div>
    </div>
  );
};

export default AIChatModal;
