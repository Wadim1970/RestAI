import React, { useState, useRef, useEffect } from 'react';
import styles from './AIChatModal.module.css';
import { useChatApi } from './useChatApi';

const AIChatModal = ({ isOpen, onClose, pageContext, guestUuid, guestFingerprint, sessionId }) => {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  
  const textAreaRef = useRef(null);
  const messagesEndRef = useRef(null);
  
  // ФЛАГ ДЛЯ ПРЕДОТВРАЩЕНИЯ ПОВТОРНОГО ПРИВЕТСТВИЯ
  const hasFetchedGreeting = useRef(false);

  const { sendMessageToAI, isLoading } = useChatApi('https://restai.space/webhook/44a4dd94-18f4-43ec-bbcd-a71c1e30308f');

  // Если закрыто — выкидываем из DOM сразу
  if (!isOpen) return null;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // ЭФФЕКТ ПРИВЕТСТВИЯ: Теперь БЕЗ sendMessageToAI в зависимостях
  useEffect(() => {
    // Если открыто и мы еще не запрашивали приветствие
    if (isOpen && !hasFetchedGreeting.current) {
      
      const fetchGreeting = async () => {
        hasFetchedGreeting.current = true; // Сразу блокируем повтор
        try {
          const aiGreeting = await sendMessageToAI(
            "ПРИВЕТСТВИЕ", 
            pageContext, 
            sessionId, 
            guestUuid, 
            guestFingerprint
          );
          setMessages([{ role: 'bot', text: aiGreeting }]);
        } catch (error) {
          console.error("Ошибка:", error);
          hasFetchedGreeting.current = false; // Разрешаем переповтор при ошибке
        }
      };

      fetchGreeting();
    }

    // Сброс флага при размонтировании
    return () => {
      if (!isOpen) {
        hasFetchedGreeting.current = false;
        setMessages([]);
      }
    };
    // ВАЖНО: Мы убрали sendMessageToAI отсюда! Это остановит бесконечный цикл #310.
  }, [isOpen, pageContext, sessionId, guestUuid, guestFingerprint]); 

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;
    const userText = inputValue;
    setInputValue(''); 
    setMessages(prev => [...prev, { role: 'user', text: userText }]);

    const aiResponse = await sendMessageToAI(userText, pageContext, sessionId, guestUuid, guestFingerprint);
    setMessages(prev => [...prev, { role: 'bot', text: aiResponse }]);
  };

  return (
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
