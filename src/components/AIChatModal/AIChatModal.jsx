import React, { useState, useRef, useEffect } from 'react'; // Подключаем React и хуки
import styles from './AIChatModal.module.css'; // Импортируем стили

const AIChatModal = ({ isOpen, onClose }) => {
  const [inputValue, setInputValue] = useState(''); // Состояние для текста в инпуте
  const [viewMode, setViewMode] = useState('text'); // Состояние режима: текст или видео
  const textAreaRef = useRef(null); // Ссылка на DOM-элемент textarea для управления высотой

  // Эффект, который срабатывает при каждом изменении текста в поле ввода
  useEffect(() => {
    if (textAreaRef.current) { // Проверяем, существует ли элемент
      textAreaRef.current.style.height = 'auto'; // Сбрасываем высоту в начальную, чтобы пересчитать заново
      const scrollHeight = textAreaRef.current.scrollHeight; // Получаем высоту контента внутри textarea
      // Устанавливаем новую высоту, но не более 150px (чтобы не перекрыть всё окно)
      textAreaRef.current.style.height = Math.min(scrollHeight, 150) + 'px';
    }
  }, [inputValue]); // Зависимость от текста: как только текст меняется, высота пересчитывается

  if (!isOpen) return null; // Если модалка закрыта, ничего не рендерим

  // Обработчик нажатия на главную кнопку действия
  const handleActionClick = () => {
    if (inputValue.trim().length > 0) { // Если в поле есть текст (кроме пробелов)
      console.log("Отправка:", inputValue); // Логируем отправку
      setInputValue(''); // Очищаем поле (высота сбросится автоматически через useEffect)
    } else {
      // Если поле пустое, переключаем режим между текстом и видео-аватаром
      setViewMode(prev => prev === 'text' ? 'video' : 'text');
    }
  };

  return (
    <div className={styles['modal-overlay']}> {/* Темный фон за модальным окном */}
      <div className={styles['modal-glassContainer']}> {/* Основной стеклянный контейнер модалки */}
        
        {/* Кнопка закрытия окна (крестик) */}
        <button className={styles['modal-closeBtn']} onClick={onClose}>
          <img src="/icons/icon-on.png" alt="Закрыть" />
        </button>

        {/* Центральная часть окна с историей чата или видео */}
        <div className={styles['modal-chatHistory']}>
          {viewMode === 'text' ? ( // Если текстовый режим:
            <div className={styles['modal-botMessage']}>
              Чем я могу вам помочь?
            </div>
          ) : ( // Если видео режим: заглушка под аватар
            <div 
              style={{ 
                width: '100%', 
                height: '100%', 
                background: '#000', // Черный фон для будущего видео
                borderRadius: '20px', 
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              <span style={{ color: '#48BF48', fontSize: '14px', opacity: 0.6 }}>
                [ ПОДКЛЮЧЕНИЕ ВИДЕО-АВАТАРА... ]
              </span>
            </div>
          )}
        </div>

        {/* Нижняя часть окна с полем ввода и кнопкой */}
        <div className={styles['modal-footerControls']}>
          <div className={styles['modal-inputWrapper']}>
            {/* ИКОНКА МЕНЮ УДАЛЕНА ОТСЮДА ПО ТВОЕМУ ЗАПРОСУ */}
            <textarea 
              ref={textAreaRef} // Привязываем ссылку для управления высотой
              className={styles['modal-textArea']} // Стили текстового поля
              rows="1" // Начальное количество строк — одна
              placeholder={viewMode === 'text' ? "Напишите сообщение..." : "Слушаю вас..."}
              value={inputValue} // Связываем значение со стейтом
              onChange={(e) => setInputValue(e.target.value)} // Обновляем стейт при вводе
            />
          </div>

          {/* Правая кнопка: меняет иконку в зависимости от наличия текста или режима */}
          <button className={styles['modal-actionButton']} onClick={handleActionClick}>
            {inputValue.trim().length > 0 ? ( // Если текст написан — иконка "Самолетик/Старт"
              <img src="/icons/free-icon-start.png" className={styles['modal-iconSend']} alt="Send" />
            ) : ( // Если текста нет — переключаем иконки Аудио/Чат в зависимости от режима окна
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
