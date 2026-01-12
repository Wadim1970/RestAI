import React, { useState, useRef, useEffect } from 'react'; // Импортируем React и стандартные хуки
import styles from './AIChatModal.module.css'; // Подключаем стили
import { useChatApi } from './useChatApi'; // Импортируем логику API

const AIChatModal = ({ isOpen, onClose, pageContext, guestUuid, guestFingerprint, sessionId }) => {
  const [inputValue, setInputValue] = useState(''); // Текст ввода пользователя
  const [messages, setMessages] = useState([]); // История сообщений

  const textAreaRef = useRef(null); // Ссылка на поле ввода
  const messagesEndRef = useRef(null); // Ссылка для автоскролла вниз

  // Подключаем API с твоим вебхуком
  const { sendMessageToAI, isLoading } = useChatApi('https://restai.space/webhook/44a4dd94-18f4-43ec-bbcd-a71c1e30308f');

  // ФИКС КНОПОК: Если модалка закрыта, возвращаем null. 
  // Это убирает невидимый слой, который блокировал клики в меню.
  if (!isOpen) return null;

  // Автопрокрутка к последнему сообщению
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Эффект для приветствия и очистки при закрытии
  useEffect(() => {
    if (isOpen && messages.length === 0 && !isLoading) {
      const fetchGreeting = async () => {
        const aiGreeting = await sendMessageToAI("ПРИВЕТСТВИЕ", pageContext, sessionId, guestUuid, guestFingerprint);
        setMessages([{ role: 'bot', text: aiGreeting }]);
      };
      fetchGreeting();
    }

    // При закрытии стейт очищается, чтобы при новом открытии всё было чисто
    return () => {
      if (!isOpen) setMessages([]);
    };
  }, [isOpen, pageContext, sessionId, guestUuid, guestFingerprint, sendMessageToAI]);

  // Скролл при каждом новом сообщении
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleInputFocus = () => scrollToBottom();

  // Функция отправки сообщения
  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userText = inputValue;
    setInputValue(''); 
    setMessages(prev => [...prev, { role: 'user', text: userText }]);

    const aiResponse = await sendMessageToAI(userText, pageContext, sessionId, guestUuid, guestFingerprint);
    setMessages(prev => [...prev, { role: 'bot', text: aiResponse }]);
  };

  return (
    // Добавляем принудительный класс active, так как рендерим только если isOpen = true
    <div className={`${styles.modalOverlay} ${styles.active}`} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose}>×</button>
        
        <div className={styles.messagesContainer}>
          {messages.map((msg, index) => (
            <div key={index} className={msg.role === 'user' ? styles.userMsg : styles.botMsg}>
              {msg.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.inputArea}>
          <textarea
            ref={textAreaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={handleInputFocus}
            placeholder="Спросите ИИ о блюдах или составе..."
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
