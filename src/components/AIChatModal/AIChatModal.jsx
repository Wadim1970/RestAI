import React, { useState } from 'react'; // Подключаем React и хук состояния для текста в поле ввода
import { useNavigate } from 'react-router-dom'; // Хук для смены страниц (навигации)
import styles from './AIChatModal.module.css'; // Стили модального окна

const AIChatModal = ({ isOpen, onClose, viewHistory }) => {
  const [inputValue, setInputValue] = useState(''); // Состояние для хранения текста, который пишет пользователь
  const navigate = useNavigate(); // Создаем функцию-штурман для перехода между страницами

  // Если модалка закрыта, ничего не рисуем
  if (!isOpen) return null; 

  /**
   * НОВАЯ ЛОГИКА ПЕРЕХОДА К ВИДЕО-ЧАТУ
   * Эта функция срабатывает при нажатии на кнопку переключения режима (например, аватарку)
   */
  const handleSwitchToVideo = () => {
    onClose(); // Сначала закрываем модальное окно чата
    navigate('/'); // ВСЕГДА переходим на главную страницу, где находится видео-аватар
  };

  // Функция для кнопки "Отправить" или "Голос" (справа от текстового поля)
  const handleAction = () => {
    if (inputValue.trim().length > 0) {
      // Если текст есть — имитируем отправку
      console.log("Отправлено:", inputValue);
      setInputValue(''); 
    } else {
      // Если текста нет — кнопка работает как "Назад"
      onClose(); 
    }
  };

  return (
    <div className={styles['modal-overlay']}>
      <div className={styles['modal-glassContainer']}>
        
        {/* Кнопка-крестик: просто закрывает окно, оставляя пользователя на текущей странице */}
        <button className={styles['modal-closeBtn']} onClick={onClose}>
          <img src="/icons/icon-on.png" alt="Закрыть" />
        </button>

        <div className={styles['modal-chatHistory']}>
          <div className={styles['modal-botMessage']}>Вам помочь с выбором?</div>
        </div>

        <div className={styles['modal-footerControls']}>
          <div className={styles['modal-inputWrapper']}>
            
            {/* ИКОНКА ПЕРЕХОДА К ВИДЕО (Аватар или иконка режима) */}
            {/* Теперь при клике мы вызываем handleSwitchToVideo, которая отправит нас на '/' */}
            <img 
              src="/icons/free-icon-main-menu-2.png" 
              className={styles['modal-menuInInput']} 
              alt="К видео-чату"
              onClick={handleSwitchToVideo} 
            />
            
            <textarea 
              className={styles['modal-textArea']}
              placeholder="Напишите сообщение..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>

          {/* Зеленая кнопка (Голос / Отправить) */}
          <button className={styles['modal-actionButton']} onClick={handleAction}>
            {inputValue.trim().length > 0 ? (
              <img src="/icons/free-icon-start.png" className={styles['modal-iconSend']} alt="Отправить" />
            ) : (
              <img src="/icons/free-icon-audio.png" className={styles['modal-iconAudio']} alt="Голос" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatModal;
