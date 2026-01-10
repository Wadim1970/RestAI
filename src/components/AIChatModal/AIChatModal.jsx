import React, { useState, useRef, useEffect } from 'react'; // Подключаем React и инструменты
import styles from './AIChatModal.module.css'; // Подключаем стили
import { useChatApi } from './useChatApi'; // Подключаем логику общения с n8n

const AIChatModal = ({ isOpen, onClose, pageContext }) => {
  const [inputValue, setInputValue] = useState(''); // Стейт для текста в поле ввода
  const [viewMode, setViewMode] = useState('text'); // Режим: чат или видео
  const [messages, setMessages] = useState([]); // Массив сообщений (история)
  
  const textAreaRef = useRef(null); // Ссылка на поле ввода для изменения высоты
  const messagesEndRef = useRef(null); // Ссылка на невидимый элемент в конце чата для автоскролла

  const { sendMessageToAI, isLoading } = useChatApi('https://restai.space/webhook/44a4dd94-18f4-43ec-bbcd-a71c1e30308f');

  // Функция, которая принудительно прокручивает контейнер вниз
  const scrollToBottom = () => {
    // scrollIntoView плавно двигает экран к элементу messagesEndRef
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  };

  // НОВОЕ: Специальная функция для Android, которая "тянет" чат вверх за клавиатурой
 const handleInputFocus = () => {
    // Убираем все setTimeout и интервалы. 
    // Если система (interactive-widget) работает, она сама подожмет экран.
    // Оставляем только разовый вызов, чтобы просто "подровнять" позицию.
    scrollToBottom();
  };

  // Следим за появлением новых сообщений или индикатора загрузки
  useEffect(() => {
    if (viewMode === 'text') {
      scrollToBottom(); // Как только массив messages изменился — скроллим вниз
    }
  }, [messages, isLoading, viewMode]); // Триггеры: новые сообщения, статус "печатает" или смена режима

  // Функция авто-роста поля ввода
  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.style.height = 'auto'; // Сброс высоты
      textAreaRef.current.style.height = Math.min(textAreaRef.current.scrollHeight, 150) + 'px'; // Рост до 150px
    }
  }, [inputValue, viewMode]);

  if (!isOpen) return null; // Если модалка закрыта — не рендерим ничего

  // Логика кнопки отправки
  const handleActionClick = async () => { 
    if (inputValue.trim().length > 0) { // Если есть текст
      const userText = inputValue.trim(); // Убираем лишние пробелы
      setInputValue(''); // Очищаем поле сразу

      const newMessages = [...messages, { role: 'user', text: userText }]; // Добавляем сообщение юзера
      setMessages(newMessages); // Обновляем экран

      // Отправляем запрос в n8n (теперь с контекстом блюда)
      const aiResponse = await sendMessageToAI(userText, pageContext, 'user-unique-id-123');
      
      // Добавляем ответ бота в историю
      setMessages(prev => [...prev, { role: 'bot', text: aiResponse }]);
    } else {
      // Если текста нет — переключаем видео/текст
      setViewMode(prev => prev === 'text' ? 'video' : 'text');
    }
  };

  return (
    <div className={styles['modal-overlay']}> {/* Темная подложка */}
      <div className={styles['modal-glassContainer']}> {/* Основное окно */}
        
        {/* Видео-аватар */}
        {viewMode === 'video' && (
          <div className={styles['videoWrapper']}>
              <div className={styles['videoPlaceholder']}>
                <span className={styles['statusText']}>
                  {isLoading ? '[ НЕЙРОСЕТЬ ГЕНЕРИРУЕТ ОТВЕТ... ]' : '[ ПОДКЛЮЧЕНИЕ ВИДЕО... ]'}
                </span>
              </div>
          </div>
        )}

        {/* Кнопка закрытия модалки */}
        <button className={styles['modal-closeBtn']} onClick={onClose}>
          <img src="/icons/icon-on.png" alt="Закрыть" />
        </button>

        {/* Область переписки */}
        {viewMode === 'text' && (
          <div className={styles['modal-chatHistory']}>
            {messages.length === 0 && (
              <div className={styles['modal-botMessage']}>Чем я могу вам помочь?</div>
            )}

            {/* Рендерим все сообщения из массива */}
            {messages.map((msg, index) => (
              <div 
                key={index} 
                className={msg.role === 'user' ? styles['userMessage'] : styles['modal-botMessage']}
              >
                {msg.text}
              </div>
            ))}

            {/* Индикатор того, что бот думает */}
            {isLoading && (
              <div className={styles['modal-botMessage']}>...</div>
            )}
            
            {/* Невидимый "якорь" в самом низу списка. К нему всегда едет скролл */}
            <div ref={messagesEndRef} style={{ float:"left", clear: "both" }} />
          </div>
        )}

        {/* Нижняя панель управления */}
        <div className={styles['modal-footerControls']}>
          {viewMode === 'text' && (
            <div className={styles['modal-inputWrapper']}>
              <textarea 
                ref={textAreaRef}
                className={styles['modal-textArea']}
                rows="1"
                placeholder="Напишите сообщение..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={isLoading}
                // ИЗМЕНЕНО: Используем новую функцию handleInputFocus для плавной работы на Android
                onFocus={handleInputFocus} 
              />
            </div>
          )}

          <button 
            key={viewMode}
            className={styles['modal-actionButton']} 
            style={viewMode === 'video' ? { marginLeft: 'auto' } : {}} 
            onClick={handleActionClick}
            disabled={isLoading && viewMode === 'text'}
          >
            {/* Иконка меняется: если есть текст — самолетик, если нет — микрофон/чат */}
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
