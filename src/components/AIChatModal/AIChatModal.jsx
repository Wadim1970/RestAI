import React, { useState, useRef, useEffect } from 'react'; // Импортируем базовые инструменты React
import styles from './AIChatModal.module.css'; // Импортируем стили этого компонента
import { useChatApi } from './useChatApi'; // Импортируем наш хук для связи с сервером n8n

// Объявляем компонент и принимаем все пропсы, включая новые ID для идентификации
const AIChatModal = ({ isOpen, onClose, pageContext, guestUuid, guestFingerprint, sessionId }) => {
  const [inputValue, setInputValue] = useState(''); // Состояние для хранения текста, который вводит пользователь
  const [messages, setMessages] = useState([]); // Состояние для хранения истории всей переписки

  const messagesEndRef = useRef(null); // Создаем ссылку на пустой div в конце списка, чтобы скроллить к нему

  // Подключаем логику запросов. Передаем адрес твоего вебхука.
  // Получаем функцию отправки и статус загрузки (isLoading)
  const { sendMessageToAI, isLoading } = useChatApi('https://restai.space/webhook/44a4dd94-18f4-43ec-bbcd-a71c1e30308f');

  // СТРАХОВКА: Если модалка закрыта — возвращаем пустоту (null). 
  // Это полностью убирает её из верстки, чтобы она не перекрывала кнопки меню.
  if (!isOpen) return null;

  // Функция для автоматической прокрутки чата вниз к последнему сообщению
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // ЭФФЕКТ ДЛЯ ПРИВЕТСТВИЯ (Исправляет ошибку #310)
  useEffect(() => {
    // Если чат открылся И в нем еще нет сообщений И сейчас ничего не загружается
    if (isOpen && messages.length === 0 && !isLoading) {
      const fetchGreeting = async () => {
        try {
          // Отправляем специальный маркер "ПРИВЕТСТВИЕ" с нашими новыми ID
          const aiGreeting = await sendMessageToAI(
            "ПРИВЕТСТВИЕ", 
            pageContext, 
            sessionId, 
            guestUuid, 
            guestFingerprint
          );
          // Когда ИИ ответил — кладем его приветствие в историю сообщений
          setMessages([{ role: 'bot', text: aiGreeting }]);
        } catch (error) {
          console.error("Ошибка при получении приветствия:", error);
        }
      };
      fetchGreeting(); // Запускаем процесс
    }
    // ВАЖНО: В зависимостях оставляем только isOpen. 
    // Если добавить сюда sendMessageToAI или messages, начнется бесконечный цикл (Error #310).
  }, [isOpen]); 

  // Эффект для автоматического скролла вниз при добавлении каждого нового сообщения
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Функция обработки отправки сообщения пользователем
  const handleSend = async () => {
    // Если поле пустое или ИИ сейчас "думает" — ничего не делаем
    if (!inputValue.trim() || isLoading) return;

    const userText = inputValue; // Копируем текст из поля ввода
    setInputValue(''); // Сразу очищаем поле ввода для удобства юзера

    // Добавляем сообщение пользователя в список на экране
    setMessages(prev => [...prev, { role: 'user', text: userText }]);

    try {
      // Отправляем запрос на сервер n8n со всеми данными
      const aiResponse = await sendMessageToAI(
        userText, 
        pageContext, 
        sessionId, 
        guestUuid, 
        guestFingerprint
      );
      // Добавляем ответ нейронки в список сообщений
      setMessages(prev => [...prev, { role: 'bot', text: aiResponse }]);
    } catch (error) {
      // Если произошла ошибка — выводим системное сообщение в чат
      setMessages(prev => [...prev, { role: 'bot', text: "Простите, произошла ошибка связи." }]);
    }
  };

  return (
    // Затемненный фон модалки. Клик по нему закрывает окно (onClose)
    <div className={styles.modalOverlay} onClick={onClose}>
      {/* Само окно чата. stopPropagation нужен, чтобы клик внутри окна не закрывал его случайно */}
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        
        {/* Кнопка-крестик для закрытия чата */}
        <button className={styles.closeButton} onClick={onClose}>×</button>

        {/* Область со списком сообщений */}
        <div className={styles.messagesContainer}>
          {messages.map((msg, index) => (
            // Отрисовываем сообщение. Класс стиля зависит от того, бот это или юзер
            <div key={index} className={msg.role === 'user' ? styles.userMsg : styles.botMsg}>
              {msg.text}
            </div>
          ))}
          {/* Элемент-якорь, к которому прилипает скролл */}
          <div ref={messagesEndRef} />
        </div>

        {/* Область ввода текста и кнопка отправки */}
        <div className={styles.inputArea}>
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()} // Отправка по Enter
            placeholder="Задайте вопрос..."
          />
          {/* Кнопка отправки. Блокируется (disabled), пока ИИ отвечает */}
          <button onClick={handleSend} disabled={isLoading}>
            {isLoading ? '...' : 'Отправить'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatModal; // Экспортируем компонент для App.jsx
