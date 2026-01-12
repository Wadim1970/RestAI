import React, { useState, useRef, useEffect } from 'react'; // Импортируем React и стандартные хуки (состояние, ссылки, эффекты)
import styles from './AIChatModal.module.css'; // Подключаем CSS-модуль для оформления чата
import { useChatApi } from './useChatApi'; // Импортируем логику взаимодействия с API n8n

// Основной компонент модалки. Принимает пропсы: открыта/закрыта, контекст страницы и новые ID для RestAI
const AIChatModal = ({ isOpen, onClose, pageContext, guestUuid, guestFingerprint, sessionId }) => {
  const [inputValue, setInputValue] = useState(''); // Создаем состояние для хранения текста, который пишет юзер
  const [viewMode, setViewMode] = useState('text'); // Состояние для переключения режимов (если планировалось видео)
  const [messages, setMessages] = useState([]); // Состояние-массив для хранения всей истории переписки

  const textAreaRef = useRef(null); // Ссылка на поле ввода (textarea) для манипуляций (например, фокуса)
  const messagesEndRef = useRef(null); // Ссылка на невидимый элемент внизу списка сообщений для автоскролла

  // Подключаем API: получаем функцию отправки и статус загрузки. Указываем твой рабочий вебхук.
  const { sendMessageToAI, isLoading } = useChatApi('https://restai.space/webhook/44a4dd94-18f4-43ec-bbcd-a71c1e30308f');

  // Функция для автоматической прокрутки окна чата к самому последнему сообщению
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); // Плавно прокручиваем к элементу-якорю
  };

  // ЭФФЕКТ ДЛЯ ПРИВЕТСТВИЯ И ОЧИСТКИ
  useEffect(() => {
    // Если модалка открыта, сообщений еще нет и API не занято запросом
    if (isOpen && messages.length === 0 && !isLoading) {
      const fetchGreeting = async () => { // Создаем асинхронную функцию для запроса
        // Отправляем маркер "ПРИВЕТСТВИЕ" вместе со всеми данными сессии и гостя
        const aiGreeting = await sendMessageToAI("ПРИВЕТСТВИЕ", pageContext, sessionId, guestUuid, guestFingerprint);
        // Добавляем полученный ответ от ИИ как первое сообщение бота
        setMessages([{ role: 'bot', text: aiGreeting }]);
      };
      fetchGreeting(); // Запускаем выполнение
    }

    // Если модалка закрывается — очищаем историю сообщений (как было в твоем оригинале)
    if (!isOpen) {
      setMessages([]);
    }
    // Следим за состоянием открытия, длиной сообщений и всеми ID идентификации
  }, [isOpen, messages.length, isLoading, pageContext, sessionId, guestUuid, guestFingerprint, sendMessageToAI]);

  // Функция фокусировки (для Android): помогает клавиатуре не перекрывать ввод
  const handleInputFocus = () => {
    scrollToBottom(); // Просто подтягиваем скролл вниз при клике в поле ввода
  };

  // Эффект: автоматически скроллим вниз каждый раз, когда массив сообщений обновляется
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Функция отправки сообщения пользователем
  const handleSend = async () => {
    // Если поле пустое или ИИ еще не ответил на прошлый вопрос — выходим
    if (!inputValue.trim() || isLoading) return;

    const userText = inputValue; // Сохраняем текст сообщения
    setInputValue(''); // Очищаем поле ввода сразу после нажатия кнопки
    
    // Добавляем сообщение пользователя в массив переписки на экране
    const newMessages = [...messages, { role: 'user', text: userText }];
    setMessages(newMessages);

    // Отправляем запрос в n8n со всеми привязанными ID (сессия, гость, отпечаток)
    const aiResponse = await sendMessageToAI(userText, pageContext, sessionId, guestUuid, guestFingerprint);

    // Добавляем ответ нейросети в чат
    setMessages(prev => [...prev, { role: 'bot', text: aiResponse }]);
  };

  // Если пропс isOpen = false, этот код всё равно отрендерит пустую обертку (как было в твоей логике)
  return (
    <div className={`${styles.modalOverlay} ${isOpen ? styles.active : ''}`} onClick={onClose}>
      {/* Контейнер модального окна. stopPropagation запрещает закрытие при клике внутри чата */}
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        
        {/* Кнопка "крестик" для закрытия окна */}
        <button className={styles.closeButton} onClick={onClose}>×</button>
        
        {/* Область, где отображаются сообщения */}
        <div className={styles.messagesContainer}>
          {messages.map((msg, index) => (
            // Выбираем стиль (свой или бота) в зависимости от роли сообщения
            <div key={index} className={msg.role === 'user' ? styles.userMsg : styles.botMsg}>
              {msg.text}
            </div>
          ))}
          {/* Пустой div, за который цепляется скролл */}
          <div ref={messagesEndRef} />
        </div>

        {/* Зона ввода сообщения */}
        <div className={styles.inputArea}>
          <textarea
            ref={textAreaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)} // Обновляем текст в стейте при вводе
            onFocus={handleInputFocus} // Вызываем фикс для мобилок при фокусе
            placeholder="Спросите ИИ о блюдах или составе..."
          />
          {/* Кнопка отправки. Блокируется, пока идет загрузка (isLoading) */}
          <button onClick={handleSend} disabled={isLoading}>
            {isLoading ? '...' : 'Отправить'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatModal; // Экспортируем компонент
