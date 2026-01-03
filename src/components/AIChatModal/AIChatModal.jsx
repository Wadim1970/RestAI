import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSwipeClose } from '../../hooks/useSwipeClose'; // Импортируем наш хук
import styles from './AIChatModal.module.css';

const AIChatModal = ({ isOpen, onClose, viewHistory }) => {
  const [inputValue, setInputValue] = useState('');
  const navigate = useNavigate();
  
  // Подключаем логику свайпа через хук
  const swipeHandlers = useSwipeClose(onClose);

  if (!isOpen) return null;

  return (
    // Вешаем обработчики на самый верхний слой (overlay)
    <div className={styles['modal-overlay']} {...swipeHandlers}>
      
      <div className={styles['modal-glassContainer']}>
        
        {/* Область истории тоже должна пробрасывать свайп, если она не скроллится */}
        <div className={styles['modal-chatHistory']}>
           <div className={styles['modal-botMessage']}>Вам помочь с выбором?</div>
        </div>

        <div className={styles['modal-footerControls']}>
          <div className={styles['modal-inputWrapper']}>
            <img 
              src="/icons/free-icon-main-menu-2.png" 
              className={styles['modal-menuInInput']} 
              alt="Меню"
              onClick={() => navigate('/menu')} 
            />
            <textarea 
              className={styles['modal-textArea']}
              placeholder="Вам помочь с выбором?"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>

          <button className={styles['modal-actionButton']} onClick={() => inputValue.trim() ? setInputValue('') : onClose()}>
            <img 
              src={inputValue.trim() ? "/icons/free-icon-start.png" : "/icons/free-icon-audio.png"} 
              className={inputValue.trim() ? styles['modal-iconSend'] : styles['modal-iconAudio']} 
              alt="Action" 
            />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatModal;
