import React, { useState, useRef, useEffect } from 'react'; // Подключаем React и хуки (инструменты)
import styles from './AIChatModal.module.css'; // Подключаем CSS-модуль
import { useChatApi } from './useChatApi'; // ИМПОРТ: Подключаем наш файл-почтальон для связи с n8n

// Добавляем pageContext в пропсы, чтобы знать, на какой странице находится юзер
const AIChatModal = ({ isOpen, onClose, pageContext }) => {
  const [inputValue, setInputValue] = useState(''); // Стейт для хранения текста пользователя
  const [viewMode, setViewMode] = useState('text'); // Режим окна: 'text' (чат) или 'video' (весь экран)
  
  // НОВЫЙ СТЕЙТ: Список всех сообщений в текущем диалоге
  const [messages, setMessages] = useState([]); 
  
  const textAreaRef = useRef(null); // Ссылка на textarea для управления её высотой

  // ИНИЦИАЛИЗАЦИЯ API: Достаем функцию отправки и статус загрузки из нашего хука
  // ЗАМЕНИ 'ТВОЙ_WEBHOOK_URL' на реальный адрес из n8n, когда он будет готов
  const { sendMessageToAI, isLoading } = useChatApi('https://your-n8n-webhook-url.com');

  // Функция авто-роста поля вверх (срабатывает при каждом изменении текста)
  useEffect(() => {
    if (textAreaRef.current) { // Если поле существует
      textAreaRef.current.style.height = 'auto'; // Сбрасываем высоту
      // Устанавливаем высоту по контенту, но не более 150px
      textAreaRef.current.style.height = Math.min(textAreaRef.current.scrollHeight, 150) + 'px';
    }
  }, [inputValue, viewMode]); // Перезапускаем при вводе или смене режима

  if (!isOpen) return null; // Если модалка не активна — ничего не выводим

  // Логика кнопки: теперь она умеет отправлять данные в n8n через useChatApi
  const handleActionClick = async () => { 
    if (inputValue.trim().length > 0) { // Если в поле есть текст (кроме пробелов)
      
      const userText = inputValue.trim(); // Сохраняем текст сообщения
      setInputValue(''); // Сразу очищаем поле ввода для удобства юзера

      // 1. Добавляем сообщение пользователя в список сообщений на экране
      const newMessages = [...messages, { role: 'user', text: userText }];
      setMessages(newMessages);

      // 2. ОТПРАВКА В n8n: Передаем текст, контекст страницы и фиксированный ID (пока так)
      const aiResponse = await sendMessageToAI(userText, pageContext, 'user-unique-id-123');

      // 3. Добавляем ответ от нейросети в список сообщений на экране
      setMessages(prev => [...prev, { role: 'bot', text: aiResponse }]);

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
                {/* Если бот "думает", пишем об этом поверх видео */}
                <span className={styles['statusText']}>
                  {isLoading ? '[ НЕЙРОСЕТЬ ГЕНЕРИРУЕТ ОТВЕТ... ]' : '[ ПОДКЛЮЧЕНИЕ ВИДЕО... ]'}
                </span>
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
            {/* Если сообщений еще нет — показываем приветствие */}
            {messages.length === 0 && (
              <div className={styles['modal-botMessage']}>Чем я могу вам помочь?</div>
            )}

            {/* Отрисовка истории переписки из стейта messages */}
            {messages.map((msg, index) => (
              <div 
                key={index} 
                className={msg.role === 'user' ? styles['userMessage'] : styles['modal-botMessage']}
              >
                {msg.text}
              </div>
            ))}

            {/* Индикатор загрузки сообщения в чате */}
            {isLoading && (
              <div className={styles['modal-botMessage']}>...</div>
            )}
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
                disabled={isLoading} // Блокируем ввод, пока ждем ответ от n8n
              />
            </div>
          )}

          {/* ВТОРАЯ КНОПКА: Зеленая, переключатель режимов/отправка */}
          <button 
            key={viewMode} // Принудительная перерисовка при смене режима (убирает артефакты)
            className={styles['modal-actionButton']} 
            style={viewMode === 'video' ? { marginLeft: 'auto' } : {}} 
            onClick={handleActionClick}
            disabled={isLoading && viewMode === 'text'} // Отключаем кнопку на время запроса
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
