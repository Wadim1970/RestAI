import React, { useState, useRef, useEffect } from 'react'; // Подключаем React и инструменты
import styles from './AIChatModal.module.css'; // Подключаем стили
import { useChatApi } from './useChatApi'; // Подключаем логику общения с n8n

// ИЗМЕНЕНИЕ: Теперь принимаем messages, setMessages и sessionId как пропсы из App.jsx
const AIChatModal = ({ isOpen, onClose, pageContext, sessionId, messages, setMessages }) => {
  const [inputValue, setInputValue] = useState(''); // Стейт для текста в поле ввода
  const [viewMode, setViewMode] = useState('text'); // Режим: чат или видео
  
  // УДАЛЕНО: локальный messages, так как теперь используем глобальный из пропсов
  
  const textAreaRef = useRef(null); // Ссылка на поле ввода для изменения высоты
  const messagesEndRef = useRef(null); // Ссылка на невидимый элемент в конце чата для автоскролла

  const { sendMessageToAI, isLoading } = useChatApi('https://restai.space/webhook/44a4dd94-18f4-43ec-bbcd-a71c1e30308f');

  // Функция, которая принудительно прокручивает контейнер вниз
  const scrollToBottom = () => {
    // scrollIntoView плавно двигает экран к элементу messagesEndRef
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  };

  // --- ОБНОВЛЕННОЕ: АВТО-ПРИВЕТСТВИЕ / РЕАКЦИЯ ПРИ КАЖДОМ ОТКРЫТИИ ---
  useEffect(() => {
    // Если модалка открыта и сейчас не идет другая загрузка
    if (isOpen && !isLoading) {
      const fetchGreeting = async () => {
        // Отправляем маркер "ПРИВЕТСТВИЕ" при КАЖДОМ открытии чата
        // ИИ получит этот маркер + актуальный pageContext и выдаст нужную фразу
        const aiGreeting = await sendMessageToAI("ПРИВЕТСТВИЕ", pageContext, sessionId);
        
        // Добавляем новый ответ ИИ в конец существующей истории (не очищая её)
        setMessages(prev => [...prev, { role: 'bot', text: aiGreeting }]);
      };
      fetchGreeting();
    }
    
    // УДАЛЕНО: if (!isOpen) { setMessages([]); } — теперь история сохраняется
  }, [isOpen]); // Следим за каждым открытием модалки

  // Специальная функция для Android, которая "тянет" чат вверх за клавиатурой
  const handleInputFocus = () => {
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

      // Отправляем запрос в n8n (теперь с контекстом блюда и динамической сессией)
      const aiResponse = await sendMessageToAI(userText, pageContext, sessionId);
      
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
            {/* Если сообщений еще нет и идет загрузка самого первого ответа */}
            {messages.length === 0 && isLoading && (
              <div className={styles['modal-botMessage']}>Подключаюсь к меню...</div>
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

            {/* Индикатор того, что бот думает (показываем только когда уже есть сообщения) */}
            {isLoading && messages.length > 0 && (
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
                // Фокус теперь просто подравнивает скролл, без лишних скачков
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
