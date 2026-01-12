import React, { useState, useRef, useEffect } from 'react';
import styles from './AIChatModal.module.css';
import { useChatApi } from './useChatApi';

const AIChatModal = ({ isOpen, onClose, pageContext, guestUuid, guestFingerprint, sessionId }) => {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const messagesEndRef = useRef(null);
  
  // Реф для предотвращения дублей и циклов
  const processing = useRef(false);
  const lastSessionId = useRef(null);

  const { sendMessageToAI, isLoading } = useChatApi('https://restai.space/webhook/44a4dd94-18f4-43ec-bbcd-a71c1e30308f');

  // Если закрыто - полностью выходим, не считаем ничего
  if (!isOpen) return null;

  useEffect(() => {
    // Если это новая сессия и мы еще не в процессе запроса
    if (isOpen && sessionId !== lastSessionId.current && !processing.current) {
      const fetchGreeting = async () => {
        processing.current = true;
        lastSessionId.current = sessionId;
        
        try {
          const res = await sendMessageToAI("ПРИВЕТСТВИЕ", pageContext, sessionId, guestUuid, guestFingerprint);
          setMessages([{ role: 'bot', text: res }]);
        } catch (e) {
          console.error(e);
        } finally {
          processing.current = false;
        }
      };
      fetchGreeting();
    }
  }, [isOpen, sessionId, pageContext, guestUuid, guestFingerprint, sendMessageToAI]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;
    const text = inputValue;
    setInputValue('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    const res = await sendMessageToAI(text, pageContext, sessionId, guestUuid, guestFingerprint);
    setMessages(prev => [...prev, { role: 'bot', text: res }]);
  };

  return (
    <div className={`${styles.modalOverlay} ${styles.active}`} onClick={onClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose}>×</button>
        <div className={styles.messagesContainer}>
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? styles.userMsg : styles.botMsg}>{m.text}</div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <div className={styles.inputArea}>
          <textarea value={inputValue} onChange={e => setInputValue(e.target.value)} placeholder="Спросите ИИ..." />
          <button onClick={handleSend} disabled={isLoading}>{isLoading ? '...' : 'Отправить'}</button>
        </div>
      </div>
    </div>
  );
};

export default AIChatModal;
