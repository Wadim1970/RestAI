import React, { useState, useRef, useEffect } from 'react'; // Подключаем ядро React и нужные инструменты (хуки)
import styles from './AIChatModal.module.css'; // Подключаем стили как объект для изоляции (CSS Modules)

const AIChatModal = ({ isOpen, onClose }) => {
  const [inputValue, setInputValue] = useState(''); // Создаем переменную для хранения текста, который пишет юзер
  const [viewMode, setViewMode] = useState('text'); // Создаем переключатель режимов: 'text' (чат) или 'video' (аватар)
  const textAreaRef = useRef(null); // Создаем «крючок» (ref), чтобы напрямую управлять высотой текстового поля в DOM

  // Эффект, который следит за вводом текста и меняет высоту поля вверх
  useEffect(() => {
    if (textAreaRef.current) { // Если ссылка на поле ввода активна
      textAreaRef.current.style.height = 'auto'; // Сначала сбрасываем высоту в авто, чтобы увидеть реальный объем текста
      // Устанавливаем высоту равную высоте контента (scrollHeight), но не более 150px
      textAreaRef.current.style.height = Math.min(textAreaRef.current.scrollHeight, 150) + 'px';
    }
  }, [inputValue]); // Запускаем этот код каждый раз, когда меняется содержимое inputValue

  if (!isOpen) return null; // Если модалка закрыта (isOpen === false), ничего не рисуем на экране

  // Главная функция кнопки: решает, отправить текст или сменить режим
  const handleActionClick = () => {
    if (inputValue.trim().length > 0) { // Если в поле есть хоть один символ (кроме пробелов)
      console.log("Отправка:", inputValue); // Имитируем отправку сообщения
      setInputValue(''); // Очищаем поле ввода (высота сбросится сама благодаря useEffect)
    } else {
      // Если поле пустое, переключаем режим: с текста на видео или наоборот
      setViewMode(prev => prev === 'text' ? 'video' : 'text');
    }
  };

  return (
    <div className={styles['modal-overlay']}> {/* Темный фон-подложка на весь экран */}
      <div className={styles['modal-glassContainer']}> {/* Основное окно с эффектом матового стекла */}
        
        {/* Кнопка закрытия (крестик) — всегда в верхнем правом углу */}
        <button className={styles['modal-closeBtn']} onClick={onClose}>
          <img src="/icons/icon-on.png" alt="Закрыть" /> {/* Твоя иконка закрытия */}
        </button>

        {/* Центральная часть: здесь либо сообщения чата, либо видео-аватар */}
        <div className={styles['modal-chatHistory']}>
          {viewMode === 'text' ? ( // Если режим "Текст":
            <div className={styles['modal-botMessage']}>
              Чем я могу вам помочь? {/* Пузырек сообщения от бота */}
            </div>
          ) : ( // Если режим "Видео":
            <div className={styles['videoWrapper']}> {/* Контейнер, который растянет видео на всё окно */}
               <div className={styles['videoPlaceholder']}>
                 <span className={styles['statusText']}>[ ПОДКЛЮЧЕНИЕ ВИДЕО... ]</span>
               </div>
            </div>
          )}
        </div>

        {/* Нижний блок управления: поле ввода и зеленая кнопка */}
        <div className={styles['modal-footerControls']}>
          <div className={styles['modal-inputWrapper']}> {/* Белая подложка для ввода */}
            <textarea 
              ref={textAreaRef} // Привязываем наш "крючок" к этому элементу
              className={styles['modal-textArea']} // Стили текста
              rows="1" // По умолчанию поле высотой в одну строку
              placeholder={viewMode === 'text' ? "Напишите сообщение..." : "Слушаю вас..."} // Меняем подсказку под режим
              value={inputValue} // Значение поля всегда берется из стейта
              onChange={(e) => setInputValue(e.target.value)} // При наборе текста обновляем стейт
            />
          </div>

          {/* Та самая зеленая кнопка: остается на месте, меняет только иконку внутри */}
          <button className={styles['modal-actionButton']} onClick={handleActionClick}>
            {inputValue.trim().length > 0 ? ( // Если текст написан — иконка "отправить"
              <img src="/icons/free-icon-start.png" className={styles['modal-iconSend']} alt="Send" />
            ) : ( // Если пусто — иконка зависит от текущего режима (аудио или чат)
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

export default AIChatModal; // Экспортируем компонент для использования в других файлах
