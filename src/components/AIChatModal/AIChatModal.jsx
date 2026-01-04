import React, { useState } from 'react'; // Подключаем React и хук для текста в поле
import { useNavigate } from 'react-router-dom'; // Хук для навигации (переход в меню)
import styles from './AIChatModal.module.css'; // Стили нашего модального окна

const AIChatModal = ({ isOpen, onClose, viewHistory }) => {
  // inputValue хранит текст, который пользователь пишет в чат
  const [inputValue, setInputValue] = useState(''); 
  const navigate = useNavigate(); // Создаем функцию для перехода на другие страницы

  // Если модалка должна быть закрыта (isOpen = false), возвращаем null (ничего не рисуем)
  if (!isOpen) return null; 

  // Функция для обработки нажатия на зеленую кнопку (отправить или закрыть)
  const handleAction = () => {
    // Если в поле есть текст (не считая пробелов)
    if (inputValue.trim().length > 0) {
      // Логика отправки (сейчас просто выводим в консоль и чистим поле)
      console.log("Сообщение отправлено:", inputValue);
      setInputValue(''); 
    } else {
      // Если текста нет, кнопка работает как "назад" и закрывает окно
      onClose();
    }
  };

  return (
    // Внешняя оболочка на весь экран
    <div className={styles['modal-overlay']}>
      
      {/* Контейнер с эффектом размытия (стекло) */}
      <div className={styles['modal-glassContainer']}>
        
        {/* КНОПКА-КРЕСТИК для закрытия окна */}
        <button className={styles['modal-closeBtn']} onClick={onClose}>
          <img src="/icons/icon-on.png" alt="Закрыть" />
        </button>

        {/* Область, где отображаются сообщения чата */}
        <div className={styles['modal-chatHistory']}>
          {/* Приветственное сообщение от бота */}
          <div className={styles['modal-botMessage']}>Вам помочь с выбором?</div>
          
          {/* Если есть история просмотров, выводим её для отладки/контекста */}
          {viewHistory && viewHistory.length > 0 && (
            <div style={{fontSize: '10px', opacity: 0.5, marginTop: '10px'}}>
              Контекст: {viewHistory.join(', ')}
            </div>
          )}
        </div>

        {/* Нижняя панель с полем ввода и кнопкой действия */}
        <div className={styles['modal-footerControls']}>
          
          {/* Белая подложка для текстового поля */}
          <div className={styles['modal-inputWrapper']}>
            
            {/* Иконка меню внутри поля ввода */}
            <img 
              src="/icons/free-icon-main-menu-2.png" 
              className={styles['modal-menuInInput']} 
              alt="Меню"
              onClick={() => navigate('/menu')} // Уходим на страницу меню
            />
            
            {/* Само поле для набора текста (textarea для многострочности) */}
            <textarea 
              className={styles['modal-textArea']}
              placeholder="Вам помочь с выбором?"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)} // Обновляем текст в памяти при каждом вводе
              /* autoFocus отсутствует, чтобы клавиатура не открывалась сама */
            />
          </div>

          {/* Круглая зеленая кнопка (справа от ввода) */}
          <button className={styles['modal-actionButton']} onClick={handleAction}>
            {/* Меняем иконку: если есть текст — стрелка, если нет — микрофон */}
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
