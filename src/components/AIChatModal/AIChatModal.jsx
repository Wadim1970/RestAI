import React, { useState, useRef, useEffect } from 'react'; // Подключаем хуки
import styles from './AIChatModal.module.css'; // Подключаем стили
import { useChatApi } from './useChatApi'; // Подключаем твой API

// Основной компонент модалки
const AIChatModal = ({ isOpen, onClose, pageContext, guestUuid, guestFingerprint, sessionId }) => {
  const [inputValue, setInputValue] = useState(''); // Стейт для ввода текста
  const [messages, setMessages] = useState([]); // Стейт для истории сообщений
  
  // РЕФ ДЛЯ ПРЕДОТВРАЩЕНИЯ ПОВТОРОВ (Error #310)
  // Этот флаг будет помнить, что мы уже отправили запрос, даже когда компонент перерисовывается
  const greetingSent = useRef(false); 
  const messagesEndRef = useRef(null); // Ссылка для скролла вниз

  // Подключаем API
  const { sendMessageToAI, isLoading } = useChatApi('https://restai.space/webhook/44a4dd94-18f4-43ec-bbcd-a71c1e30308f');

  // Если модалка закрыта — убираем её из DOM (чтобы не мешала кнопкам меню)
  if (!isOpen) return null;

  // Функция автопрокрутки
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // ЭФФЕКТ ПРИВЕТСТВИЯ (ИСПРАВЛЕННЫЙ)
  useEffect(() => {
    // Условие: если открыто, запрос еще НЕ отправлялся и сейчас не идет загрузка
    if (isOpen && !greetingSent.current && !isLoading) {
      
      const fetchGreeting = async () => {
        greetingSent.current = true; // СРАЗУ ставим флаг в true, чтобы не было дублей
        try {
          // Отправляем запрос приветствия
          const aiGreeting = await sendMessageToAI(
            "ПРИВЕТСТВИЕ", 
            pageContext, 
            sessionId, 
            guestUuid, 
            guestFingerprint
          );
          // Добавляем ответ бота в чат
          setMessages([{ role: 'bot', text: aiGreeting }]);
        } catch (error) {
          console.error("Ошибка чата:", error);
          greetingSent.current = false; // Если ошибка — разрешаем попробовать еще раз
        }
      };

      fetchGreeting();
    }
    
    // Сброс флага при закрытии модалки (чтобы при следующем открытии сработало снова)
    return () => {
      if (!isOpen) {
        greetingSent.current = false;
      }
    };
  }, [isOpen, pageContext, sessionId, guestUuid, guestFingerprint]); // Теперь зависимости не вызовут цикл благодаря флагу greetingSent

  // Эффект для скролла при появлении сообщений
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Обработка отправки сообщения
  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return; // Если пусто или грузится — выходим

    const userText = inputValue;
    setInputValue(''); // Чистим поле ввода
    setMessages(prev => [...prev, { role: 'user', text: userText }]); // Показываем текст юзера

    try {
      // Отправляем в n8n
      const aiResponse = await sendMessageToAI(
        userText, 
        pageContext, 
        sessionId, 
        guestUuid, 
        guestFingerprint
      );
      // Показываем ответ ИИ
      setMessages(prev => [...prev, { role: 'bot', text: aiResponse }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'bot', text: "Ошибка связи с сервером." }]);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        {/* Кнопка закрыть */}
        <button className={styles.closeButton} onClick={onClose}>×</button>

        {/* Список сообщений */}
        <div className={styles.messagesContainer}>
          {messages.map((msg, index) => (
            <div key={index} className={msg.role === 'user' ? styles.userMsg : styles.botMsg}>
              {msg.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Ввод текста */}
        <div className={styles.inputArea}>
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Задайте вопрос..."
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
