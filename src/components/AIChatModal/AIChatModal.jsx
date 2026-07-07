import React, { useState, useRef, useEffect } from 'react'; // Подключаем React и инструменты
import styles from './AIChatModal.module.css'; // Подключаем стили
import { useChatApi } from './useChatApi'; // Подключаем логику общения с n8n

// ИЗМЕНЕНИЕ: Теперь принимаем messages, setMessages и sessionId как пропсы из App.jsx
const AIChatModal = ({ isOpen, onClose, pageContext, sessionId, messages, setMessages, guestId, restaurantId }) => {
  const [inputValue, setInputValue] = useState(''); // Стейт для текста в поле ввода
  const [viewMode, setViewMode] = useState('text'); // Режим: чат или видео
  
  // УДАЛЕНО: локальный messages, так как теперь используем глобальный из пропсов
  
  const textAreaRef = useRef(null); // Ссылка на поле ввода для изменения высоты
  const messagesEndRef = useRef(null); // Ссылка на невидимый элемент в конце чата для автоскролла

  // Свайп вниз для закрытия — тот же паттерн, что в DishModal/CartModal
  const [isClosing, setIsClosing] = useState(false); // Стейт для анимации закрытия
  const touchStart = useRef(null); // Координата Y начала касания
  const touchEnd = useRef(null); // Координата Y конца/движения касания
  const modalRef = useRef(null); // Ссылка на само окно (чтобы его двигать)
  const chatHistoryRef = useRef(null); // Ссылка на скроллящуюся историю чата
  const minSwipeDistance = 150; // Минимальный свайп в пикселях для закрытия окна

  const { sendMessageToAI, isLoading } = useChatApi('https://restai.space/webhook/44a4dd94-18f4-43ec-bbcd-a71c1e30308f');

  // Функция запуска анимации и закрытия
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  };

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
    }
  }, [isOpen]);

  // Начало касания
  const onTouchStart = (e) => {
    touchStart.current = e.targetTouches[0].clientY;
    touchEnd.current = e.targetTouches[0].clientY;
  };

  // Движение пальца — тянем модалку визуально, только если история уже
  // проскроллена до самого верха (или мы в видео-режиме, где скролла нет)
  const onTouchMove = (e) => {
    touchEnd.current = e.targetTouches[0].clientY;
    const distance = touchEnd.current - touchStart.current;
    const atTop = !chatHistoryRef.current || chatHistoryRef.current.scrollTop <= 0;

    if (distance > 0 && atTop && modalRef.current) {
      modalRef.current.style.transform = `translateY(${distance}px)`;
      modalRef.current.style.transition = 'none';
    }
  };

  // Окончание касания
  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;
    const distance = touchEnd.current - touchStart.current;
    const atTop = !chatHistoryRef.current || chatHistoryRef.current.scrollTop <= 0;

    if (distance > minSwipeDistance && atTop) {
      handleClose();
    } else if (modalRef.current) {
      modalRef.current.style.transform = 'translateY(0)';
      modalRef.current.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)';
    }

    touchStart.current = null;
    touchEnd.current = null;
  };

  // Не даём системному pull-to-refresh сработать поверх нашего жеста,
  // когда история уже в самом верху и палец тянет вниз
  useEffect(() => {
    const listEl = chatHistoryRef.current;
    if (!isOpen || !listEl) return;

    const handleSystemScroll = (e) => {
      const distance = e.touches[0].clientY - touchStart.current;
      if (distance > 0 && listEl.scrollTop <= 0) {
        if (e.cancelable) e.preventDefault();
      }
    };

    listEl.addEventListener('touchmove', handleSystemScroll, { passive: false });
    return () => listEl.removeEventListener('touchmove', handleSystemScroll);
  }, [isOpen, viewMode]);

  // Эффект "печати": ответ уже пришёл целиком, но на экране открывается
  // постепенно, по несколько символов за тик — визуально как живой чат.
  const [typingText, setTypingText] = useState(null); // полный текст текущего "печатаемого" сообщения
  const [typedLength, setTypedLength] = useState(0); // сколько символов уже показано
  const typingIntervalRef = useRef(null);

  const typeOutMessage = (text) => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
    }
    setTypingText(text);
    setTypedLength(0);
    typingIntervalRef.current = setInterval(() => {
      setTypedLength(prev => {
        const next = prev + 3;
        if (next >= text.length) {
          clearInterval(typingIntervalRef.current);
          typingIntervalRef.current = null;
          setMessages(m => [...m, { role: 'bot', text }]);
          setTypingText(null);
          return 0;
        }
        return next;
      });
    }, 20);
  };

  // Не даём интервалу пережить размонтирование компонента
  useEffect(() => {
    return () => {
      if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
    };
  }, []);

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
        const aiGreeting = await sendMessageToAI("ПРИВЕТСТВИЕ", pageContext, sessionId, restaurantId, guestId);

        // Показываем ответ ИИ эффектом печати, в историю попадёт по завершении
        typeOutMessage(aiGreeting);
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
  }, [messages, isLoading, viewMode, typedLength]); // Триггеры: новые сообщения, статус "печатает", смена режима, рост печатаемого текста

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
      const aiResponse = await sendMessageToAI(userText, pageContext, sessionId, restaurantId, guestId);

      // Показываем ответ эффектом печати, в историю попадёт по завершении
      typeOutMessage(aiResponse);
    } else {
      // Если текста нет — переключаем видео/текст
      setViewMode(prev => prev === 'text' ? 'video' : 'text');
    }
  };

  return (
    <div className={`${styles['modal-overlay']} ${isClosing ? styles.fadeOut : ''}`}> {/* Темная подложка */}
      <div
        ref={modalRef}
        className={`${styles['modal-glassContainer']} ${isClosing ? styles.slideDown : ''}`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      > {/* Основное окно */}

        {/* Индикатор свайпа вниз для закрытия */}
        <div className={styles.dragLine}></div>

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
        <button className={styles['modal-closeBtn']} onClick={handleClose}>
          <img src="/icons/icon-on.png" alt="Закрыть" />
        </button>

        {/* Область переписки */}
        {viewMode === 'text' && (
          <div className={styles['modal-chatHistory']} ref={chatHistoryRef}>
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

            {/* Сообщение, которое сейчас "печатается" символ за символом */}
            {typingText !== null && (
              <div className={styles['modal-botMessage']}>
                {typingText.slice(0, typedLength)}
              </div>
            )}

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
