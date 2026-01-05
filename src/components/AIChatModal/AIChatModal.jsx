import React, { useState, useRef, useEffect } from 'react'; // Подключаем React и хуки (инструменты)
import styles from './AIChatModal.module.css'; // Подключаем CSS-модуль

const AIChatModal = ({ isOpen, onClose }) => {
  const [inputValue, setInputValue] = useState(''); // Стейт для хранения текста пользователя
  const [viewMode, setViewMode] = useState('text'); // Режим окна: 'text' (чат) или 'video' (весь экран)
  const textAreaRef = useRef(null); // Ссылка на textarea для управления её высотой

  // Функция авто-роста поля вверх (срабатывает при каждом изменении текста)
  useEffect(() => {
    if (textAreaRef.current) { // Если поле существует
      textAreaRef.current.style.height = 'auto'; // Сбрасываем высоту
      // Устанавливаем высоту по контенту, но не более 150px
      textAreaRef.current.style.height = Math.min(textAreaRef.current.scrollHeight, 150) + 'px';
    }
  }, [inputValue, viewMode]); // Перезапускаем при вводе или смене режима

  if (!isOpen) return null; // Если модалка не активна — ничего не выводим

  // Логика кнопки: если есть текст — шлем его, если нет — меняем видео/текст
  const handleActionClick = () => {
    if (inputValue.trim().length > 0) { // Если в поле есть текст (кроме пробелов)
      console.log("Сообщение:", inputValue); // Логируем (потом здесь будет API)
      setInputValue(''); // Очищаем ввод
    } else {
      // Если пусто — переключаем экран между чатом и видео-аватаром
      setViewMode(prev => prev === 'text' ? 'video' : 'text');
    }
  };

  return (
    <div className={styles['modal-overlay']}> {/* Темная подложка на весь экран */}
      <div className={styles['modal-glassContainer']}> {/* Стеклянный корпус окна */}
        
        {/* ВИДЕО-АВАТАР (Отрисовывается только в режиме видео на весь экран) */}
        {viewMode === 'video' && (
          <div className={styles['videoWrapper']}> {/* Слой видео без границ и скруглений */}
             <div className={styles['videoPlaceholder']}>
               <span className={styles['statusText']}>[ ПОДКЛЮЧЕНИЕ ВИДЕО... ]</span>
             </div>
          </div>
        )}

        {/* ПЕРВАЯ КНОПКА: Крестик (всегда вверху справа, поверх видео и чата) */}
        <button className={styles['modal-closeBtn']} onClick={onClose}>
          <img src="/icons/icon-on.png" alt="Закрыть" />
        </button>

        {/* ОБЛАСТЬ ЧАТА (Отрисовывается только в режиме текста) */}
        {viewMode === 'text' && (
          <div className={styles['modal-chatHistory']}>
            <div className={styles['modal-botMessage']}>Чем я могу вам помочь?</div>
          </div>
        )}

        {/* НИЖНЯЯ ПАНЕЛЬ (Поле ввода и ВТОРАЯ КНОПКА) */}
        <div className={styles['modal-footerControls']}>
          
          {/* ПОЛЕ ВВОДА: показываем ТОЛЬКО в текстовом режиме */}
          {viewMode === 'text' && (
            <div className={styles['modal-inputWrapper']}>
              <textarea 
                ref={textAreaRef} // Привязываем ref
                className={styles['modal-textArea']}
                rows="1"
                placeholder="Напишите сообщение..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
            </div>
          )}

          {/* ВТОРАЯ КНОПКА: Зеленая, переключатель режимов/отправка */}
          {/* Если мы в видео, отодвигаем её вправо через marginLeft: auto */}
        <button 
  key={viewMode} // ДОБАВЛЕНО: принудительная перерисовка при смене режима
  className={styles['modal-actionButton']} 
  style={viewMode === 'video' ? { marginLeft: 'auto' } : {}} 
  onClick={handleActionClick}
>
  {inputValue.trim().length > 0 ? ( 
    <img src="/icons/free-icon-start.png" className={styles['modal-iconSend']} alt="Send" />
  ) : (
    <img 
      src={viewMode === 'text' ? "/icons/free-icon-audio.png" : "/icons/free-icon-chat.png"} 
      className={styles['modal-iconAudio']} 
      alt="Switch" 
    />
  )}
</button>
        </div>
      </div>
    </div>
  );
};

export default AIChatModal;
