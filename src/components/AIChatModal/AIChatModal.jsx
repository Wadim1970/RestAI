import React, { useState, useRef, useEffect } from 'react'; // Подключаем React и инструменты
import { useNavigate } from 'react-router-dom';
import styles from './AIChatModal.module.css'; // Подключаем стили
import { useChatApi } from './useChatApi'; // Подключаем логику общения с n8n
import VoiceStage from './VoiceStage'; // Экран голосового ИИ
import MenuButton from '../MenuButton.jsx'; // Та же кнопка, что и на видео-заставке

// isFirstLaunch — открыт по окончании стартового видео (первый разговор
// с ИИ за сессию), а не кнопкой "Чат" из меню. На этом экране вместо
// переключателя голос/текст показываем прямую кнопку "Открыть меню" —
// не хотим тут же предлагать уйти в текст тому, кто ещё не решил,
// разговаривать ли вообще; переключатель как обычно доступен при входе
// через меню.
// ИЗМЕНЕНИЕ: Теперь принимаем messages, setMessages и sessionId как пропсы из App.jsx
const AIChatModal = ({ isOpen, onClose, pageContext, sessionId, messages, setMessages, guestId, restaurantId, tableNumber, isFirstLaunch = false, prewarm = false, onExpandDish, onCartAdd, onShowCart }) => {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState(''); // Стейт для текста в поле ввода
  const [viewMode, setViewMode] = useState('text'); // Режим: чат или голос
  
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

  const handleGoToMenu = () => {
    handleClose();
    navigate('/menu');
  };

  // Модалка примонтирована один раз на всё приложение и никогда не
  // размонтируется (App.jsx держит её всегда, просто isOpen=false) — поэтому
  // useState('text') выше отрабатывает как дефолт только один раз в жизни
  // компонента, и при каждом новом открытии режим нужно выставлять явно, а
  // не полагаться на то, в каком он остался с прошлого раза. Голосом
  // встречает только видео на главном экране (isFirstLaunch) — вход через
  // кнопку "Чат" в меню как был текстовым, так и остаётся.
  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setViewMode(isFirstLaunch ? 'voice' : 'text');
    }
  }, [isOpen, isFirstLaunch]);

  // Начало касания
  const onTouchStart = (e) => {
    touchStart.current = e.targetTouches[0].clientY;
    touchEnd.current = e.targetTouches[0].clientY;
  };

  // Движение пальца — тянем модалку визуально, только если история уже
  // проскроллена до самого верха (или мы в голосовом режиме, где скролла нет)
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

  // --- АВТО-ПРИВЕТСТВИЕ ТЕКСТОВОГО ЧАТА ---
  // Голосовой режим здоровается сам (голосом, через инструкции модели) —
  // этот эффект нужен только когда гость реально в текстовом режиме
  // (открыл его сам через переключатель внутри модалки), иначе при каждом
  // голосовом открытии он бы зря дёргал n8n и копил в истории невидимое
  // текстовое приветствие.
  useEffect(() => {
    if (isOpen && viewMode === 'text' && !isLoading) {
      const fetchGreeting = async () => {
        // Отправляем маркер "ПРИВЕТСТВИЕ" при каждом входе в текстовый режим
        // ИИ получит этот маркер + актуальный pageContext и выдаст нужную фразу
        const aiGreeting = await sendMessageToAI("ПРИВЕТСТВИЕ", pageContext, sessionId, restaurantId, guestId);

        // Показываем ответ ИИ эффектом печати, в историю попадёт по завершении
        typeOutMessage(aiGreeting);
      };
      fetchGreeting();
    }

    // УДАЛЕНО: if (!isOpen) { setMessages([]); } — теперь история сохраняется
  }, [isOpen, viewMode]);

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
      // Если текста нет — переключаем голос/текст
      setViewMode(prev => prev === 'text' ? 'voice' : 'text');
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

        {/* Индикатор свайпа вниз для закрытия — только в текстовом режиме.
            На голосовом экране он не к месту (там своя раскладка с шаром и
            слайдером), поэтому в voice-режиме не рендерим. */}
        {viewMode !== 'voice' && <div className={styles.dragLine}></div>}

        {/* Голосовой ИИ */}
        {viewMode === 'voice' && (
          <VoiceStage
            guestId={guestId}
            restaurantId={restaurantId}
            tableNumber={tableNumber}
            sessionId={sessionId}
            prewarm={prewarm}
            onExpandDish={onExpandDish}
            onCartAdd={onCartAdd}
            onShowCart={onShowCart}
          />
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

          {/* На первом голосовом экране тут вместо переключателя ничего —
              настоящая кнопка "Открыть меню" ниже, вне modal-glassContainer,
              это буквально тот же MenuButton что и на видео-заставке. */}
          {!(isFirstLaunch && viewMode === 'voice') && (
            <button
              key={viewMode}
              className={styles['modal-actionButton']}
              style={viewMode === 'voice' ? { marginLeft: 'auto' } : {}}
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
          )}
        </div>
      </div>

      {/* Та же самая кнопка, тот же класс buttons-footer-fixed, что и на
          MainScreen — не имитация, а буквально MenuButton, чтобы при
          переходе видео -> голос гость видел ровно ту же кнопку на том
          же месте, без единого пикселя смещения. Вне modal-glassContainer
          (у него transform, ломающий position:fixed у потомков), но
          внутри modal-overlay (без transform) — так фиксация идёт
          от вьюпорта, как и на MainScreen. */}
      {isFirstLaunch && viewMode === 'voice' && (
        <div className="buttons-footer-fixed">
          <MenuButton onClick={handleGoToMenu} />
        </div>
      )}
    </div>
  );
};

export default AIChatModal;
