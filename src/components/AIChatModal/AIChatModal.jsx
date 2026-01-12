import React, { useState, useRef, useEffect } from 'react'; // Импорт инструментов React
import styles from './AIChatModal.module.css'; // Импорт стилей (модульных)
import { useChatApi } from './useChatApi'; // Импорт логики запросов к ИИ

// ОСТАВЛЯЕМ ТОЛЬКО ОДНО ОБЪЯВЛЕНИЕ ФУНКЦИИ
const AIChatModal = ({ isOpen, onClose, pageContext, guestUuid, guestFingerprint, sessionId }) => {
  const [inputValue, setInputValue] = useState(''); // Состояние для текста ввода
  const [messages, setMessages] = useState([]); // Состояние для истории сообщений
  
  const textAreaRef = useRef(null); // Ссылка на поле ввода
  const messagesEndRef = useRef(null); // Ссылка для автоскролла

  // Подключаем API. URL вебхука из твоего кода
  const { sendMessageToAI, isLoading } = useChatApi('https://restai.space/webhook/44a4dd94-18f4-43ec-bbcd-a71c1e30308f');

  // ГЛАВНОЕ: Если модалка закрыта — возвращаем null, чтобы она физически исчезла и не блокировала клики
  if (!isOpen) return null;

  // Функция автоскролла вниз
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Эффект для приветствия и очистки при закрытии
  useEffect(() => {
    if (isOpen && messages.length === 0 && !isLoading) {
      const fetchGreeting = async () => {
        // Отправляем ПРИВЕТСТВИЕ со всеми новыми ID
        const aiGreeting = await sendMessageToAI("ПРИВЕТСТВИЕ", pageContext, sessionId, guestUuid, guestFingerprint);
        setMessages([{ role: 'bot', text: aiGreeting }]);
      };
      fetchGreeting();
    }
  }, [isOpen, sessionId, guestUuid, guestFingerprint]); // Следим за важными ID

  // Функция отправки сообщения
  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return; // Не отправляем пустоту

    const userText = inputValue;
    setInputValue(''); // Чистим поле ввода
    
    // Добавляем сообщение пользователя в чат
    setMessages(prev => [...prev, { role: 'user', text: userText }]);

    // Запрос к ИИ со всеми новыми данными
    const aiResponse = await sendMessageToAI(userText, pageContext, sessionId, guestUuid, guestFingerprint);

    // Добавляем ответ бота
    setMessages(prev => [...prev, { role: 'bot', text: aiResponse }]);
    scrollToBottom(); // Листаем вниз
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        {/* Кнопка закрытия */}
        <button className={styles.closeButton} onClick={onClose}>×</button>
        
        {/* Контейнер сообщений */}
        <div className={styles.messagesContainer}>
          {messages.map((msg, index) => (
            <div key={index} className={msg.role === 'user' ? styles.userMsg : styles.botMsg}>
              {msg.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Поле ввода */}
        <div className={styles.inputArea}>
          <textarea 
            ref={textAreaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Спросите ИИ..."
          />
          <button onClick={handleSend} disabled={isLoading}>
            {isLoading ? '...' : 'Отправить'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatModal;
