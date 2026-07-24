import React, { useState, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import MainScreen from './components/MainScreen';
import HomeGate from './components/HomeGate.jsx';
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal';
import DishModal from './components/DishModal/DishModal';
import CartModal from './components/CartModal/CartModal';
import SplitBillModal from './components/SplitBillModal/SplitBillModal';
import PaymentFlowModal from './components/PaymentFlowModal/PaymentFlowModal';
import QuizModal from './components/QuizModal/QuizModal';
import PersonalCabinet from './components/PersonalCabinet/PersonalCabinet';
import { BrandingProvider } from './context/BrandingContext';
import { ThemeProvider } from './components/ThemeProvider';
import { useBrandingConfig } from './hooks/useBrandingConfig';
import { supabase } from './supabaseClient';

// Общий источник device_id и для register_guest_visit, и для place_guest_order —
// одно устройство должно всегда попадать в одно и то же место (seat) за столом.
function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem('restai_device_id');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem('restai_device_id', deviceId);
  }
  return deviceId;
}

 // Получаем ID ресторана из URL параметров или localStorage
 function AppContent() {
  const [restaurantId, setRestaurantId] = useState(null);
  const [tableNumber, setTableNumber] = useState(null); // 1. Добавляем стейт для номера столика
  const [callStatus, setCallStatus] = useState('idle'); // 'idle' | 'pending' | 'acknowledged' — вызов официанта
  const activeCallIdRef = useRef(null); // id текущего вызова — нужен для отмены
  const activeCallChannelRef = useRef(null); // realtime-канал текущего вызова
  const callBusyRef = useRef(false); // замок: запрос вызова/отмены в полёте — игнорируем повторные тапы
  const callTimeoutRef = useRef(null); // таймер авто-сброса залипшего pending
  // Пока эффект ниже не отработал — ещё не знаем, известен ли стол из
  // URL/localStorage. Без этого флага HomeGate на первом рендере успевал
  // бы мигнуть сканером камеры даже тогда, когда стол на самом деле уже
  // известен (tableNumber стартует с null, эффект выставляет его чуть позже).
  const [entryResolved, setEntryResolved] = useState(false);

  // Флажок «Профиль» показываем только на экране меню — на заставке и
  // голосовом экране его быть не должно. Роут берём из useLocation (HashRouter).
  const location = useLocation();
  const isOnMenu = location.pathname === '/menu';

  // Получаем ID ресторана и номер столика из URL параметров или localStorage
  useEffect(() => {
    // 2. Читаем параметры после знака "?"
    const params = new URLSearchParams(window.location.search);
    const idFromUrl = params.get('restaurant_id');
    const tableFromUrl = params.get('table'); // Ищем параметр &table=9
    
    if (idFromUrl) {
      const prevId = localStorage.getItem('restaurant_id');
      setRestaurantId(idFromUrl);
      localStorage.setItem('restaurant_id', idFromUrl);

      // 3. Если в ссылке есть номер стола, тоже сохраняем его
      if (tableFromUrl) {
        setTableNumber(tableFromUrl);
        localStorage.setItem('table_number', tableFromUrl);
      } else {
        // Ссылка с restaurant_id, но без &table (переход/перезагрузка/PWA
        // start_url). Не теряем ранее сохранённый стол ТОГО ЖЕ ресторана —
        // иначе корзина выживает, а стол пропадает, и "Отправить на кухню"
        // упирается в "не удалось определить столик".
        const savedTable = localStorage.getItem('table_number');
        if (savedTable && prevId === idFromUrl) {
          setTableNumber(savedTable);
        }
      }
    } else {
      // 4. Если зашли без параметров (например, обновили страницу), берем из памяти
      const savedId = localStorage.getItem('restaurant_id');
      const savedTable = localStorage.getItem('table_number');
      
      if (savedId) {
        setRestaurantId(savedId);
        if (savedTable) {
          setTableNumber(savedTable);
        }
      } else {
        // ⭐ Дефолтный ресторан на случай прямых заходов (без QR)
        const defaultId = 'dd89773c-0952-4fd1-9510-514094a928ee'; // Ваш реальный ID
        setRestaurantId(defaultId);
        localStorage.setItem('restaurant_id', defaultId);
        // Номер стола не задаем, так как это прямой заход не из-за столика
      }
    }

    setEntryResolved(true);
  }, []);

  // Сканер внутри приложения (GuestScanner) вызывает это при успешном скане
  // QR стола — тот же путь сохранения, что и для стола из URL выше, чтобы
  // дальше всё (заказ, счёт, RPC) работало одинаково независимо от того,
  // как стол стал известен.
  const handleTableScanned = (rid, table) => {
    setRestaurantId(rid);
    setTableNumber(table);
    localStorage.setItem('restaurant_id', rid);
    localStorage.setItem('table_number', table);
  };

  // Загружаем брендинг для текущего ресторана
  const { branding, loading: brandingLoading } = useBrandingConfig(restaurantId);
useEffect(() => {
  console.log('🔍 branding объект:', branding);
  console.log('🔍 branding.font_url_header:', branding?.font_url_header);
  console.log('🔍 branding.font_url_body:', branding?.font_url_body);
  console.log('🔍 restaurantId:', restaurantId);
  console.log('🔍 brandingLoading:', brandingLoading);
}, [branding, restaurantId, brandingLoading]);

    // ========================================================
  // --- ФОНОВАЯ ИДЕНТИФИКАЦИЯ И РЕГИСТРАЦИЯ ГОСТЯ ---
  // ========================================================
  const [guestId, setGuestId] = useState(null); // Здесь будет храниться порядковый номер гостя (id из БД)
  const [seatNumber, setSeatNumber] = useState(null); // Место этого устройства в общем заказе стола (из place_guest_order)
  // id активной сессии стола (mark_table_occupied). По нему приложение
  // отслеживает, не закрыл ли официант стол (тогда сбрасываем сессию гостя),
  // и по нему же освобождает стол при авто-закрытии по бездействию.
  const [tableSessionId, setTableSessionId] = useState(null);

  useEffect(() => {
    const initializeGuest = async () => {
      const deviceId = getOrCreateDeviceId();

      try {
        // Атомарная регистрация визита одним запросом (register_guest_visit):
        // раньше здесь было "прочитать visit_count -> посчитать +1 в браузере ->
        // записать" в два похода, из-за чего два почти одновременных вызова
        // (React StrictMode дважды подряд вызывает эффект, два таба на одном
        // устройстве) читали одно и то же старое значение и теряли инкремент.
        // INSERT ... ON CONFLICT ... SET visit_count = visit_count + 1 в самой
        // базе исключает эту гонку.
        const { data, error } = await supabase.rpc('register_guest_visit', {
          p_device_id: deviceId,
        })

        if (error) throw error

        const guest = data?.[0]
        if (guest) {
          setGuestId(guest.id)
          console.log(`Гость №${guest.id}, визит: ${guest.visit_count}`)
        }
      } catch (err) {
        console.error("Системная ошибка при инициализации гостя:", err);
      }
    };

    initializeGuest();
  }, []); // Отработает 1 раз при старте приложения
  // ========================================================
  
  // --- СОСТОЯНИЕ КОРЗИНЫ ---
  const [cart, setCart] = useState(() => {
    const savedCart = localStorage.getItem('restaurant_cart');
    if (!savedCart) return {};
    const parsed = JSON.parse(savedCart);
     // Filter out any invalid (null, NaN, or non-positive) entries left by previous bugs
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => typeof v === 'number' && v > 0)
    ); 
  });

  // --- СОСТОЯНИЕ ЗАКАЗОВ ---
  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    const savedOrders = localStorage.getItem('restaurant_orders');
    return savedOrders ? JSON.parse(savedOrders) : []; 
  });

  // --- СОСТОЯНИЕ ИСТОРИИ ЧАТА ---
  const [chatMessages, setChatMessages] = useState(() => {
    const savedChat = localStorage.getItem('chat_history');
    return savedChat ? JSON.parse(savedChat) : [];
  });

  // --- СОСТОЯНИЕ МОДАЛКИ И КОНТЕКСТА ---
  const [isChatOpen, setIsChatOpen] = useState(false);
  // Как открыли чат в последний раз: 'video' — по окончании стартового
  // видео (первый разговор за сессию, кнопка "Открыть меню" вместо
  // переключателя голос/текст), 'menu' — кнопкой "Чат" из меню (обычный
  // переключатель). См. AIChatModal isFirstLaunch.
  const [chatEntryPoint, setChatEntryPoint] = useState('menu');
  // Блюдо, открытое из слайдера голосового ассистента (тап по карточке
  // куба в VoiceDishSlider) — тот же DishModal, что и в меню, отдельный
  // от него экземпляр состояния, потому что MenuPage не обязательно
  // смонтирован, пока идёт голосовой разговор. Сам список показанных ИИ
  // блюд живёт локально в VoiceStage, сюда долетает только тап на "открыть подробнее".
  const [expandedDish, setExpandedDish] = useState(null);
  // Идёт видео-заставка первого запуска — голос в это время прогревается
  // под ней (prewarm), приветствие отложено до её окончания. См.
  // handleIntroStart/handleIntroEnd и prewarm у AIChatModal.
  const [introPlaying, setIntroPlaying] = useState(false);
  // Корзина, которую голосовой ИИ показывает поверх чата (add_to_cart/
  // show_cart в voice-relay). Количество блюд живёт в общем cart (чтобы
  // совпадало с корзиной в меню), а данные добавленных ИИ блюд (фото,
  // цена) — здесь: App не грузит полное меню, как MenuPage, поэтому сам
  // не знает карточек блюд без этого словаря.
  const [voiceDishesById, setVoiceDishesById] = useState({});
  const [isVoiceCartOpen, setIsVoiceCartOpen] = useState(false);
  const [isBillRequested, setIsBillRequested] = useState(false);
  const [isBillChoiceOpen, setIsBillChoiceOpen] = useState(false); // Верхний выбор: позвать официанта / оплатить самому
  const [isPayChoiceOpen, setIsPayChoiceOpen] = useState(false);   // Выбор: за себя / за весь стол
  const [billMode, setBillMode] = useState('pay');                 // 'waiter' | 'pay' — ветка, из которой пришли в выбор
  const [isSplitBillOpen, setIsSplitBillOpen] = useState(false);   // Экран выбора корзин по местам
  const [payFlowSeats, setPayFlowSeats] = useState(null);          // Места для оплаты -> открывает поток чек/СБП
  const [tableTotalAmount, setTableTotalAmount] = useState(0);
  // Викторина-гейт перед экраном чек/оплата ('pay') или перед оценкой
  // ресторана ('waiter') — стоит МЕЖДУ выбором способа рассчитаться и
  // самим экраном, а не поверх него. pendingAfterQuizRef хранит то
  // действие, которое викторина отложила (открыть оплату / показать
  // отзыв), и выполняется один раз, когда викторина завершается любым
  // из трёх путей (отказ / неверный ответ / успешная регистрация).
  const [quizTrigger, setQuizTrigger] = useState(null); // 'pay' | 'waiter' | null
  const pendingAfterQuizRef = useRef(null);
  const [isCabinetOpen, setIsCabinetOpen] = useState(false);
  const [cabinetRegistrationContext, setCabinetRegistrationContext] = useState(null); // { questionId, selectedIndex } | null
  const [isProcessing, setIsProcessing] = useState(false);
  const [ratingFood, setRatingFood] = useState(0); // Оценка кухни (0-5)
  const [ratingService, setRatingService] = useState(0); // Оценка сервиса (0-5)
  const [reviewComment, setReviewComment] = useState(''); // Текст отзыва
  const [isReviewSubmitted, setIsReviewSubmitted] = useState(false); // Отправлен ли отзыв
  const [viewHistory, setViewHistory] = useState([]);
  const [chatContext, setChatContext] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    const savedSession = localStorage.getItem('ai_chat_session');
    return savedSession || '';
  });

  // Эффект: сохранение корзины
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart));
  }, [cart]);

  // Эффект: сохранение истории заказов
  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders));
  }, [confirmedOrders]);

  // Эффект: сохранение чата
  useEffect(() => {
    localStorage.setItem('chat_history', JSON.stringify(chatMessages));
  }, [chatMessages]);

  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem('ai_chat_session', currentSessionId);
    } else {
      localStorage.removeItem('ai_chat_session');
    }
  }, [currentSessionId]);

  // Функция отслеживания просмотров
  const trackDishView = (dishName) => {
    setViewHistory(prev => [...prev, dishName]);
  };

  // Открыть текстовый чат с контекстом конкретного блюда/раздела — общий
  // обработчик для кнопки чата в MenuPage и для той же кнопки внутри
  // DishModal, когда карточку открыл голосовой ассистент (expandedDish).
  const handleOpenChatFromDish = (dish, currentSection) => {
    if (!currentSessionId) {
      setCurrentSessionId(`sess_${Date.now()}`);
    }

    if (dish) {
      const info = `Блюдо: ${dish.dish_name}. Описание: ${dish.description}. Состав: ${dish.ingredients}`;
      setChatContext(info);
    } else if (currentSection) {
      setChatContext(`Пользователь сейчас просматривает раздел меню: "${currentSection}"`);
    } else {
      setChatContext('Общее меню ресторана');
    }
    setChatEntryPoint('menu');
    setIsChatOpen(true);
  };

  // Голосовой ИИ положил блюда в корзину (add_to_cart). Обновляем и общий
  // cart (количества — чтобы совпадало с корзиной в меню), и словарь
  // данных блюд (для показа карточек в корзине поверх чата).
  const handleVoiceCartAdd = (items) => {
    if (!Array.isArray(items) || items.length === 0) return;
    setVoiceDishesById((prev) => {
      const next = { ...prev };
      for (const it of items) if (it?.id) next[it.id] = it;
      return next;
    });
    for (const it of items) {
      if (it?.id) updateCart(Math.max(1, Number(it.quantity) || 1), it.id);
    }
  };

  // Голосовой ИИ показывает гостю корзину (show_cart).
  const handleVoiceShowCart = () => setIsVoiceCartOpen(true);

  // Голосовой ИИ убирает корзину с экрана (hide_cart) — гость сказал
  // «убери/закрой корзину».
  const handleVoiceHideCart = () => setIsVoiceCartOpen(false);

  // Заставка началась (гость нажал «войти», видео заиграло) — СРАЗУ
  // открываем голосовой чат в режиме прогрева (prewarm): под видео молча
  // готовятся соединение, сессия Grok и контекст, но приветствие ждёт.
  // Так к концу 7-сек анимации остаётся только сгенерировать приветствие
  // (~2-3с) вместо всей цепочки (~10с).
  const handleIntroStart = () => {
    if (!currentSessionId) {
      setCurrentSessionId(`sess_${Date.now()}`);
    }
    setChatContext('Общее меню ресторана');
    setChatEntryPoint('video');
    setIntroPlaying(true);
    setIsChatOpen(true);
  };

  // Заставка доиграла — снимаем prewarm: VoiceStage включает микрофон и
  // просит приветствие, видео уходит, гость видит голосовой экран.
  const handleIntroEnd = () => {
    setIntroPlaying(false);
  };

  const updateCart = (delta, dishId) => {
    setCart(prev => {
      const currentCount = prev[dishId] || 0;
      const newCount = Math.max(0, currentCount + delta); 
      if (newCount === 0) {
        const { [dishId]: _, ...rest } = prev; 
        return rest;
      }
      return { ...prev, [dishId]: newCount };
    });
  };

  const handleConfirmOrder = async (cartItems, comment = '') => {
    // 1. ПРОВЕРКА ЗАМКА: Если процесс уже идет, игнорируем клик
    if (isProcessing) return;

    // Бывает, что restaurantId в URL/localStorage есть, а table — нет
    // (прямой заход без QR, или сессия началась до сканирования). Без
    // номера стола отправлять нечего: String(null) даёт строку "null",
    // которая на сервере ломает cast в integer с непонятной ошибкой —
    // проверяем здесь, а не даём дойти до сервера с мусором.
    if (!restaurantId || !tableNumber) {
      alert("Не удалось определить ваш столик. Пожалуйста, отсканируйте QR-код на столе заново.");
      return;
    }

    setIsProcessing(true); // Закрываем замок

    // Не создаём заказ сами (JSONB-блоб + придуманная клиентом цена) —
    // place_guest_order сама находит/открывает общий заказ этого стола,
    // назначает место по device_id и берёт цену из menu_items. Один и тот
    // же order_id получат все устройства за этим столом (официант видит
    // единый заказ), а order_items/order_guests — та же модель, что уже
    // использует Waiter-app.
    const itemsToSend = cartItems.map(item => ({
      item_id: item.id,
      quantity: item.count,
      // Пожелания к блюду, записанные голосовым ИИ (add_to_cart -> comment).
      // place_guest_order кладёт их в order_items.comment — официант видит.
      // У блюд, добавленных из меню, поля нет — уходит undefined, это ок.
      comment: item.comment || undefined,
      // Выбранные опции блюда (прожарка/соус/…) — только id; place_guest_order
      // сам берёт наценку из БД и пишет order_item_modifiers.
      modifiers: Array.isArray(item.modifiers) && item.modifiers.length
        ? item.modifiers.map(m => m.id)
        : undefined,
    }));

    try {
      const { data, error } = await supabase.rpc('place_guest_order', {
        p_restaurant_id: restaurantId,
        p_table_number: String(tableNumber),
        p_device_id: getOrCreateDeviceId(),
        p_items: itemsToSend,
        p_comment: comment || null
      });

      if (error) {
        console.error("Ошибка записи заказа в БД:", error);
        alert("Произошла ошибка при отправке заказа. Позовите, пожалуйста, официанта.");
        return;
      }

      console.log('✅ Заказ успешно отправлен на кухню:', data?.[0]);
      if (data?.[0]?.seat_number != null) setSeatNumber(data[0].seat_number);
      setConfirmedOrders(prev => [...prev, ...cartItems]);
      setCart({});

    } catch (err) {
      console.error("Системная ошибка при оформлении:", err);
    } finally {
      // 2. СНИМАЕМ ЗАМОК в любом случае (даже если была ошибка)
      setIsProcessing(false);
    }
  };
const handleRequestBill = async () => {
  // Если есть подтвержденные заказы, предлагаем выбор
  if (confirmedOrders.length > 0) {
    // 🔥 ПОЛУЧАЕМ СУММУ ВСЕХ НЕОПЛАЧЕННЫХ ЗАКАЗОВ ЗА СТОЛОМ
    if (restaurantId && tableNumber) {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('total_amount')
          .eq('restaurant_id', restaurantId)
          .eq('table_number', tableNumber)
          .in('status', ['new', 'cooking'])
          // Защитный пояс: в норме на стол одновременно 1-2 неоплаченных
          // заказа, но запрос сам по себе от этого не застрахован (если
          // статус когда-то "зависнет" из-за бага — не даём накопиться
          // без границы).
          .limit(20);
        
        if (error) {
          console.error('Ошибка получения суммы стола:', error);
        } else if (data) {
          const tableTotal = data.reduce((sum, order) => sum + (order.total_amount || 0), 0);
          console.log('💰 Общий счет за стол:', tableTotal);
          
          // Сохраняем в state для использования в модалке
          setTableTotalAmount(tableTotal);
        }
      } catch (err) {
        console.error('Ошибка запроса суммы стола:', err);
      }
    }
    
    setIsBillChoiceOpen(true);
  } else {
    alert("Вы еще ничего не заказали!");
  }
};

// Живой вызов официанта (кнопка-колокольчик в MenuFooter). RPC сама решает
// адресата (конкретный официант, если ровно один закреплён за столом
// сегодня, иначе — все на смене в ресторане) и возвращает id вызова —
// подписываемся на него, чтобы узнать момент отклика. Повторное нажатие,
// пока вызов ещё не принят — отмена (гость не может отменить ПРИНЯТЫЙ
// вызов, только висящий в ожидании).
// Снять активный вызов у гостя: убрать realtime-канал, обнулить id и таймер
// авто-сброса. Общий хелпер для отмены, отклика и авто-сброса.
const clearActiveCall = () => {
  if (activeCallChannelRef.current) {
    supabase.removeChannel(activeCallChannelRef.current);
    activeCallChannelRef.current = null;
  }
  activeCallIdRef.current = null;
  if (callTimeoutRef.current) {
    clearTimeout(callTimeoutRef.current);
    callTimeoutRef.current = null;
  }
};

const handleCallWaiter = async () => {
  if (!restaurantId || !tableNumber) return;
  // Замок от повторных нажатий: пока запрос вызова/отмены в полёте — игнор.
  // Без него быстрые тапы (особенно под нагрузкой, когда ответ RPC медленный)
  // плодили дубли-вызовы и утекшие realtime-каналы — это и раскачивало Realtime.
  if (callBusyRef.current) return;
  if (callStatus === 'acknowledged') return; // ждём, пока тост сам погаснет

  // Повторное нажатие, пока вызов ещё не принят — отмена.
  if (callStatus === 'pending') {
    callBusyRef.current = true;
    const callId = activeCallIdRef.current;
    clearActiveCall();
    setCallStatus('idle');
    try {
      if (callId) await supabase.rpc('cancel_waiter_call', { p_call_id: callId });
    } catch (err) {
      console.error('Ошибка отмены вызова:', err);
    } finally {
      callBusyRef.current = false;
    }
    return;
  }

  // Новый вызов.
  callBusyRef.current = true;
  try {
    const { data: callId, error } = await supabase.rpc('call_waiter', {
      p_restaurant_id: restaurantId,
      p_table_number: String(tableNumber),
    });

    if (error) {
      console.error('Ошибка вызова официанта:', error);
      return;
    }

    // call_waiter теперь возвращает id ОДНОГО вызова на стол (свой новый либо
    // уже висящий — второй гость за столом подхватит тот же). Подписываемся.
    clearActiveCall();
    activeCallIdRef.current = callId;
    setCallStatus('pending');

    const channel = supabase
      .channel(`waiter_call:${callId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'waiter_calls', filter: `id=eq.${callId}`,
      }, (payload) => {
        if (payload.new.status === 'acknowledged') {
          clearActiveCall();
          setCallStatus('acknowledged');
          setTimeout(() => setCallStatus('idle'), 4000);
        }
      })
      .subscribe();

    activeCallChannelRef.current = channel;

    // Авто-сброс залипшего pending: если официант не ответил за 2 минуты —
    // возвращаем кнопку в idle, чтобы не залипала навсегда. Вызов в БД
    // остаётся (официант ещё может принять); повторный тап через дедуп
    // подхватит тот же вызов.
    callTimeoutRef.current = setTimeout(() => {
      if (activeCallIdRef.current === callId) {
        clearActiveCall();
        setCallStatus('idle');
      }
    }, 120000);

    // Push — дополнительный канал поверх Realtime, специально для случая,
    // когда приложение официанта полностью свёрнуто (тогда ни звук, ни
    // сама подписка выше не сработают — JS страницы не выполняется).
    // Best-effort: если запрос не дойдёт, живой канал всё равно отработает,
    // пока официант не свернул приложение целиком.
    const waiterApiUrl = import.meta.env.VITE_WAITER_API_URL;
    if (waiterApiUrl) {
      fetch(`${waiterApiUrl.replace(/\/$/, '')}/api/send-waiter-call-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId }),
      }).catch(() => {});
    }
  } catch (err) {
    console.error('Системная ошибка при вызове официанта:', err);
  } finally {
    callBusyRef.current = false;
  }
};

// Пока гость ждёт ответа, телефон может заблокироваться/уйти в фон —
// Realtime-соединение вкладки браузер мог оборвать, и UPDATE-событие
// об отклике официанта до неё уже не долетит (тот же класс бага, что
// был у официанта с пропущенными вызовами, только тут наоборот — гость
// не узнаёт, что вызов приняли, колокольчик трепыхается бесконечно).
// При возврате видимости — сверяем статус вызова напрямую, а не ждём
// событие.
useEffect(() => {
  const checkCallStatus = async () => {
    const callId = activeCallIdRef.current;
    if (!callId || callStatus !== 'pending') return;
    try {
      const { data, error } = await supabase
        .from('waiter_calls')
        .select('status')
        .eq('id', callId)
        .single();

      if (!error && data?.status === 'acknowledged') {
        clearActiveCall();
        setCallStatus('acknowledged');
        setTimeout(() => setCallStatus('idle'), 4000);
      }
    } catch (err) {
      console.error('Ошибка проверки статуса вызова:', err);
    }
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') checkCallStatus();
  };
  document.addEventListener('visibilitychange', handleVisibility);
  return () => document.removeEventListener('visibilitychange', handleVisibility);
}, [callStatus]);

// Общий хвост обеих веток оплаты: гость уходит — чистим его локальные
// данные и показываем экран благодарности. Оплата (какие места помечены
// paid) и уведомление официанта (статус стола через RPC) к этому моменту
// уже сделаны вызывающей функцией — отдельный вебхук на n8n больше не нужен
// (раньше он POST-ил на заглушку-URL и просто 404-ил, добавляя задержку).
const finishGuestSession = async () => {
  setCart({});
  setConfirmedOrders([]);
  setChatMessages([]);
  setCurrentSessionId('');
  localStorage.removeItem('restaurant_cart');
  localStorage.removeItem('restaurant_orders');
  localStorage.removeItem('chat_history');
  localStorage.removeItem('ai_chat_session');

  setIsBillRequested(true);
};

// Верхний выбор ведёт в один и тот же экран "за себя / за весь стол", но
// помнит ветку: официанту тоже важно знать тип счёта (общий/раздельный).
const handleChooseCallWaiter = () => {
  setBillMode('waiter');
  setIsBillChoiceOpen(false);
  setIsPayChoiceOpen(true);
};

const handleChoosePay = () => {
  setBillMode('pay');
  setIsBillChoiceOpen(false);
  setIsPayChoiceOpen(true);
};

// Ветка "позвать официанта": оплаты нет. RPC request_bill ставит статус
// стола 'bill_requested' и тип счёта — официант мгновенно видит
// "Ждут счёт · раздельный/общий" (Realtime). Гость платит официанту.
const callWaiterWithBill = async (billType) => {
  if (isProcessing) return;
  setIsProcessing(true);
  setIsPayChoiceOpen(false);

  try {
    if (restaurantId && tableNumber) {
      const { error } = await supabase.rpc('request_bill', {
        p_restaurant_id: restaurantId,
        p_table_number: String(tableNumber),
        p_bill_type: billType,
      });
      if (error) console.error('Ошибка запроса счёта:', error);
    }
    // Официант уже вызван — пока он несёт счёт, показываем викторину.
    // Экран с оценкой ресторана (finishGuestSession) откроется, когда
    // викторина завершится (в любом из трёх исходов).
    pendingAfterQuizRef.current = () => finishGuestSession('waiter');
    setQuizTrigger('waiter');
  } finally {
    setIsProcessing(false);
  }
};

// "За себя": в ветке официанта -> раздельный счёт; в ветке оплаты -> поток
// чек/СБП по своему месту (paid проставится только после подтверждения).
const handlePayChoiceOwn = () => {
  if (billMode === 'waiter') { callWaiterWithBill('personal'); return; }
  setIsPayChoiceOpen(false);
  if (seatNumber != null) {
    // Чек формируется — сначала викторина, поток оплаты откроется по её завершении.
    pendingAfterQuizRef.current = () => setPayFlowSeats([seatNumber]);
    setQuizTrigger('pay');
  }
};

// "За весь стол": в ветке официанта -> общий счёт; в ветке оплаты -> выбор
// корзин (SplitBillModal), затем поток чек/СБП.
const handlePayChoiceTable = () => {
  if (billMode === 'waiter') { callWaiterWithBill('table'); return; }
  setIsPayChoiceOpen(false);
  setIsSplitBillOpen(true);
};

const handleSplitBillClose = () => {
  setIsSplitBillOpen(false);
};

// Гость выбрал места в SplitBillModal -> сначала викторина, затем поток
// оплаты по этим местам.
const handleSplitBillConfirm = (seats) => {
  setIsSplitBillOpen(false);
  if (seats && seats.length > 0) {
    pendingAfterQuizRef.current = () => setPayFlowSeats(seats);
    setQuizTrigger('pay');
  }
};

// Викторина закрылась без регистрации (отказ / неверный ответ / вопросов
// не осталось) -> выполняем то, что было отложено (открыть оплату или
// показать экран отзыва), как будто викторины и не было.
const handleQuizDone = () => {
  setQuizTrigger(null);
  const next = pendingAfterQuizRef.current;
  pendingAfterQuizRef.current = null;
  if (next) next();
};

// Верный ответ -> без промежуточных окон сразу переключаем на личный
// кабинет с баннером регистрации поверх него (там же телефон/имя/SMS).
const handleQuizCorrectAnswer = (questionId, selectedIndex) => {
  setQuizTrigger(null);
  setCabinetRegistrationContext({ questionId, selectedIndex });
  setIsCabinetOpen(true);
};

// Кабинет закрылся. Если он был открыт из викторины (registrationContext) —
// неважно, успела ли пройти регистрация или гость просто закрыл окно —
// возвращаемся туда, куда вели до викторины. Если кабинет открыли вручную
// свайпом — это обычное закрытие, откладывать нечего.
const handleCabinetClose = () => {
  setIsCabinetOpen(false);
  if (cabinetRegistrationContext) {
    setCabinetRegistrationContext(null);
    handleQuizDone();
  }
};

// Оплата (мок-успех) прошла внутри PaymentFlowModal, места уже помечены paid —
// закрываем поток и завершаем сессию гостя.
const handlePayFlowPaid = async () => {
  setPayFlowSeats(null);
  setIsProcessing(true);
  try {
    await finishGuestSession('payment');
  } finally {
    setIsProcessing(false);
  }
};
    // Полное завершение сеанса гостя после счёта/оплаты. Продолжать заказ в
    // том же сеансе нельзя: устаревшее состояние клиента детерминированно
    // ломает повторную оплату (виснет "Подтверждаем..." — с перезагрузкой ок,
    // без неё виснет). Уводим на чистый старт БЕЗ стола (window.location.replace
    // = свежий клиент, как ручная перезагрузка), чтобы для нового заказа гость
    // заново отсканировал QR-код стола.
    const endGuestSession = () => {
      localStorage.removeItem('restaurant_cart');
      localStorage.removeItem('restaurant_orders');
      localStorage.removeItem('chat_history');
      localStorage.removeItem('ai_chat_session');
      localStorage.removeItem('table_number');
      const rid = localStorage.getItem('restaurant_id') || restaurantId || '';
      window.location.replace(rid ? `/?restaurant_id=${encodeURIComponent(rid)}` : '/');
    };

    // Как только гость положил ЧТО-ТО в корзину — открываем сессию стола со
    // статусом «Занят», ещё ДО отправки заказа: официант сразу видит, что за
    // столом кто-то заказывает. Триггер именно на добавление в корзину (а не
    // на простой просмотр меню), чтобы «зашёл посмотреть и ушёл» не занимал
    // стол. Идемпотентно — если сессия уже идёт (в т.ч. «готовится»), RPC не
    // трогает её статус, а только возвращает id для отслеживания закрытия.
    useEffect(() => {
      if (!restaurantId || !tableNumber) return;
      if (tableSessionId) return; // уже отметили — повторно не дёргаем
      const hasActivity = Object.keys(cart).length > 0 || confirmedOrders.length > 0;
      if (!hasActivity) return;
      let cancelled = false;
      (async () => {
        try {
          const { data, error } = await supabase.rpc('mark_table_occupied', {
            p_restaurant_id: restaurantId,
            p_table_number: String(tableNumber),
          });
          if (error) {
            // Раньше ошибка глоталась молча — если RPC нет в БД (миграция не
            // накатана) или упала, «Занят» просто не появлялся без следов.
            console.error('mark_table_occupied вернул ошибку:', error);
            return;
          }
          if (!cancelled) {
            const row = Array.isArray(data) ? data[0] : data;
            if (row?.session_id) setTableSessionId(row.session_id);
          }
        } catch (err) {
          console.error('Не удалось отметить стол занятым:', err);
        }
      })();
      return () => { cancelled = true; };
    }, [restaurantId, tableNumber, cart, confirmedOrders, tableSessionId]);

    // Жизненный цикл гостевой сессии, пока гость просто в меню (не в потоке
    // счёта/оплаты — там свой сброс, дёргать reload нельзя):
    //   (1) официант закрыл стол / оплата -> сессия стала неактивной ->
    //       уводим гостя на скан QR (endGuestSession);
    //   (2) гость ничего не заказал и не трогает меню 10 минут -> закрываем
    //       «занятый» стол и тоже уводим на скан QR.
    useEffect(() => {
      if (!tableSessionId) return;

      // В потоке закрытия счёта у гостя свои экраны (оплата, викторина,
      // отзыв, «спасибо») — хард-reload их бы оборвал. Там не вмешиваемся.
      const inCheckoutFlow =
        isBillRequested || payFlowSeats !== null || quizTrigger !== null || isReviewSubmitted;
      if (inCheckoutFlow) return;

      let stopped = false;

      // (1) Стол закрыли — sessionId больше не активен.
      const checkSessionAlive = async () => {
        if (stopped) return;
        try {
          const { data, error } = await supabase.rpc('is_table_session_active', {
            p_session_id: tableSessionId,
          });
          if (!error && data === false && !stopped) {
            endGuestSession();
          }
        } catch (err) {
          console.warn('Не удалось проверить статус сессии стола:', err);
        }
      };
      const pollId = setInterval(checkSessionAlive, 30000);
      const onVisible = () => { if (document.visibilityState === 'visible') checkSessionAlive(); };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', checkSessionAlive);

      // (2) Таймер бездействия — только когда заказывать гость ещё не начал
      // (корзина пуста и подтверждённых заказов нет). Любое касание/скролл
      // сбрасывает отсчёт.
      const IDLE_MS = 10 * 60 * 1000; // 10 минут
      const idleEligible = Object.keys(cart).length === 0 && confirmedOrders.length === 0;
      let idleTimer = null;
      const onIdleFire = async () => {
        if (stopped) return;
        // Состояние могло измениться за время отсчёта — сверяемся ещё раз.
        if (Object.keys(cart).length !== 0 || confirmedOrders.length !== 0) return;
        try {
          await supabase.rpc('release_table_if_occupied', { p_session_id: tableSessionId });
        } catch { /* всё равно уводим гостя на скан QR */ }
        endGuestSession();
      };
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(onIdleFire, IDLE_MS);
      };
      const interactionEvents = idleEligible ? ['pointerdown', 'keydown', 'scroll', 'touchstart'] : [];
      interactionEvents.forEach((e) => window.addEventListener(e, resetIdle, { passive: true }));
      if (idleEligible) resetIdle();

      return () => {
        stopped = true;
        clearInterval(pollId);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', checkSessionAlive);
        if (idleTimer) clearTimeout(idleTimer);
        interactionEvents.forEach((e) => window.removeEventListener(e, resetIdle));
      };
    }, [tableSessionId, isBillRequested, payFlowSeats, quizTrigger, isReviewSubmitted, cart, confirmedOrders]);

    const handleSubmitReview = async () => {
    // Если ничего не заполнили — просто завершаем сеанс (без стола, требуем QR)
    if (ratingFood === 0 && ratingService === 0 && reviewComment.trim() === '') {
        endGuestSession();
        return;
    }

    setIsProcessing(true); // Защита от двойного клика

    try {
        // Отзыв — только через проверяющий RPC submit_review: он пускает
        // отзыв, лишь если с этого устройства реально был заказ за этим
        // столом. Прямая анонимная вставка в reviews закрыта (анти-накрутка).
        const { error } = await supabase.rpc('submit_review', {
            p_restaurant_id: restaurantId,
            p_table_number: String(tableNumber),
            p_device_id: getOrCreateDeviceId(),
            p_rating_food: ratingFood,
            p_rating_service: ratingService,
            p_comment: reviewComment,
            p_session_id: currentSessionId,
        });

        if (error) throw error;

        // Опционально: Отправка вебхука в Телеграм владельцу
        /*
        fetch('ВАШ_URL_N8N_ДЛЯ_ОТЗЫВОВ', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'new_review',
                table: tableNumber,
                food: ratingFood,
                service: ratingService,
                text: reviewComment
            })
        });
        */

        setIsReviewSubmitted(true); // Показываем "Спасибо!"

        // Показали "Спасибо!" 3 сек и завершаем сеанс (уводим на чистый старт).
        setTimeout(() => {
            endGuestSession();
        }, 3000);

    } catch (error) {
        console.error("Ошибка при отправке отзыва:", error);
        alert("Не удалось отправить отзыв, но спасибо за ваше время!");
        endGuestSession();
    } finally {
        setIsProcessing(false);
    }
  };
  return (
    <BrandingProvider branding={branding} loading={brandingLoading}>
      <ThemeProvider>
        <Routes>
          <Route
            path="/"
            element={
              entryResolved ? (
                <HomeGate
                  restaurantId={restaurantId}
                  tableNumber={tableNumber}
                  onScanned={handleTableScanned}
                  onIntroStart={handleIntroStart}
                  onIntroEnd={handleIntroEnd}
                  isChatOpen={isChatOpen}
                />
              ) : (
                <div style={{ position: 'fixed', inset: 0, background: '#000' }} />
              )
            }
          />
          <Route 
            path="/menu" 
            element={
              <MenuPage 
                restaurantId={restaurantId}
                cart={cart} 
                updateCart={updateCart} 
                confirmedOrders={confirmedOrders}
                onConfirmOrder={handleConfirmOrder}
                onRequestBill={handleRequestBill}
                onCallWaiter={handleCallWaiter}
                isCallPending={callStatus === 'pending'}
                onOpenChat={handleOpenChatFromDish}
                trackDishView={trackDishView} 
              />
            } 
          />
        </Routes>

        <AIChatModal
          isOpen={isChatOpen}
          onClose={() => {
            setIsChatOpen(false);
            setChatContext('');
            setExpandedDish(null);
            setIsVoiceCartOpen(false);
            setIntroPlaying(false);
          }}
          viewHistory={viewHistory}
          pageContext={chatContext}
          sessionId={currentSessionId}
          messages={chatMessages}
          setMessages={setChatMessages}
          restaurantId={restaurantId} // <-- ДОБАВИЛИ ЭТО
          guestId={guestId}           // <-- ДОБАВИЛИ ЭТО
          tableNumber={tableNumber}
          isFirstLaunch={chatEntryPoint === 'video'}
          prewarm={introPlaying}
          onExpandDish={setExpandedDish}
          onCartAdd={handleVoiceCartAdd}
          onShowCart={handleVoiceShowCart}
          onHideCart={handleVoiceHideCart}
        />

        {/* Полная карточка блюда по тапу в кубе-слайдере голосового ассистента —
            тот же DishModal, что и в меню, но с более высоким z-index (поверх
            AIChatModal целиком, включая сам слайдер, а не под ним). */}
        <DishModal
          isOpen={!!expandedDish}
          onClose={() => setExpandedDish(null)}
          dish={expandedDish}
          currentCount={expandedDish ? (cart[expandedDish.id] || 0) : 0}
          updateCart={updateCart}
          onOpenChat={handleOpenChatFromDish}
          overlayZIndex={1000000}
        />

        {/* Корзина, вызванная голосовым ИИ (show_cart) — тот же CartModal,
            что и в меню, с кнопкой «Отправить заказ» (onConfirmOrder=
            handleConfirmOrder). Позиции берём из общего cart + данных блюд,
            которые ИИ добавил (voiceDishesById), поверх чата. */}
        <CartModal
          isOpen={isVoiceCartOpen}
          onClose={() => setIsVoiceCartOpen(false)}
          cartItems={Object.keys(cart)
            .filter((id) => voiceDishesById[id])
            .map((id) => ({ ...voiceDishesById[id], count: cart[id] }))}
          confirmedOrders={confirmedOrders || []}
          updateCart={updateCart}
          onConfirmOrder={handleConfirmOrder}
          onRequestBill={handleRequestBill}
          overlayZIndex={1000000}
        />

        <SplitBillModal
          isOpen={isSplitBillOpen}
          onClose={handleSplitBillClose}
          restaurantId={restaurantId}
          tableNumber={tableNumber}
          mySeatNumber={seatNumber}
          onConfirm={handleSplitBillConfirm}
        />

        <PaymentFlowModal
          isOpen={payFlowSeats !== null}
          onClose={() => setPayFlowSeats(null)}
          restaurantId={restaurantId}
          tableNumber={tableNumber}
          seatNumbers={payFlowSeats || []}
          onPaid={handlePayFlowPaid}
        />

        <QuizModal
          isOpen={quizTrigger !== null}
          trigger={quizTrigger}
          guestId={guestId}
          onDone={handleQuizDone}
          onCorrectAnswer={handleQuizCorrectAnswer}
        />

        {/* Флажок-свайп личного кабинета виден только внутри сеанса за столиком */}
        {tableNumber && (
          <PersonalCabinet
            isOpen={isCabinetOpen}
            onOpen={() => setIsCabinetOpen(true)}
            onClose={handleCabinetClose}
            deviceId={getOrCreateDeviceId()}
            showTab={isOnMenu}
            registrationContext={cabinetRegistrationContext}
          />
        )}

        {/* Официант откликнулся на вызов — показываем на несколько секунд и гасим сами */}
        {callStatus === 'acknowledged' && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)', zIndex: 999999, padding: '1rem',
          }}>
            <div style={{
              background: '#FBFBF9', borderRadius: '1rem', padding: '1.5rem 2rem',
              textAlign: 'center', fontFamily: 'var(--font-heading, sans-serif)',
              fontWeight: 700, fontSize: '1.1rem', color: '#304D22', maxWidth: '20rem',
            }}>
              Официант уже спешит к вам
            </div>
          </div>
        )}

             {/* ВЕРХНИЙ ВЫБОР: позвать официанта / оплатить самому */}
{isBillChoiceOpen && (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 9999,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  }}>
    <div style={{
      backgroundColor: '#fff', padding: '24px', borderRadius: '16px',
      width: '85%', maxWidth: '340px', textAlign: 'center',
      boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
    }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '20px', color: '#111' }}>Счёт</h3>
      <p style={{ margin: '0 0 24px', color: '#666', fontSize: '15px' }}>
        Как вам удобно рассчитаться?
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Позвать официанта */}
        <button
          onClick={handleChooseCallWaiter}
          disabled={isProcessing}
          style={{
            padding: '14px', backgroundColor: '#f0f0f0', color: '#111',
            border: '1px solid #ddd', borderRadius: '10px', fontSize: '16px', fontWeight: '600',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px'
          }}
        >
          <span>Позвать официанта со счётом</span>
          <span style={{ fontSize: '13px', fontWeight: '400', color: '#666' }}>
            официант принесёт счёт к столу
          </span>
        </button>

        {/* Оплатить самому */}
        <button
          onClick={handleChoosePay}
          disabled={isProcessing}
          style={{
            padding: '14px', backgroundColor: '#111', color: '#fff',
            border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: '600',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px'
          }}
        >
          <span>Оплатить самому (СБП)</span>
          <span style={{ fontSize: '13px', fontWeight: '400', color: '#ccc' }}>
            оплата в приложении
          </span>
        </button>

        <button
          onClick={() => setIsBillChoiceOpen(false)}
          style={{
            padding: '10px', background: 'none', color: '#999',
            border: 'none', fontSize: '14px', marginTop: '4px'
          }}
        >
          Отмена
        </button>
      </div>
    </div>
  </div>
)}

             {/* ВЫБОР ОПЛАТЫ: за себя / за весь стол */}
{isPayChoiceOpen && (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 9999,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  }}>
    <div style={{
      backgroundColor: '#fff', padding: '24px', borderRadius: '16px',
      width: '85%', maxWidth: '340px', textAlign: 'center',
      boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
    }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '20px', color: '#111' }}>
        {billMode === 'waiter' ? 'Какой счёт принести?' : 'За кого платите?'}
      </h3>
      <p style={{ margin: '0 0 24px', color: '#666', fontSize: '15px' }}>
        {billMode === 'waiter'
          ? 'Официант принесёт общий или раздельный счёт.'
          : 'Можно оплатить только свой заказ или выбрать корзины за столом.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* За себя / раздельный */}
        <button
          onClick={handlePayChoiceOwn}
          style={{
            padding: '14px', backgroundColor: '#f0f0f0', color: '#111',
            border: '1px solid #ddd', borderRadius: '10px', fontSize: '16px', fontWeight: '600',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px'
          }}
        >
          <span>{billMode === 'waiter' ? 'Мой счёт (раздельный)' : 'Только за себя'}</span>
          <span style={{ fontSize: '18px', fontWeight: '700', color: '#48BF48' }}>
            {confirmedOrders.reduce((sum, item) => sum + (item.cost_rub * item.count), 0)} ₽
          </span>
        </button>

        {/* За весь стол / общий */}
        <button
          onClick={handlePayChoiceTable}
          style={{
            padding: '14px', backgroundColor: '#111', color: '#fff',
            border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: '600',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px'
          }}
        >
          <span>{billMode === 'waiter' ? 'Общий счёт за стол' : 'За весь стол'}</span>
          <span style={{ fontSize: '18px', fontWeight: '700' }}>
            {tableTotalAmount} ₽
          </span>
        </button>

        <button
          onClick={() => setIsPayChoiceOpen(false)}
          style={{
            padding: '10px', background: 'none', color: '#999',
            border: 'none', fontSize: '14px', marginTop: '4px'
          }}
        >
          Отмена
        </button>
      </div>
    </div>
  </div>
)}
       
       {/* КРАСИВОЕ ОКНО ВМЕСТО ALERT */}
              {/* ФИНАЛЬНОЕ ОКНО С ОТЗЫВОМ */}
        {isBillRequested && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px'
          }}>
            <div style={{
              backgroundColor: '#fff', padding: '24px', borderRadius: '20px',
              width: '100%', maxWidth: '360px', textAlign: 'center',
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
            }}>
              
              {!isReviewSubmitted ? (
                <>
                  <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: '22px', color: '#111' }}>Официант в пути!</h3>
                    <p style={{ margin: '0', color: '#666', fontSize: '14px' }}>
                      Пока мы несем счет, поделитесь впечатлениями. Это идет напрямую владельцу.
                    </p>
                  </div>

                  {/* Оценка Кухни */}
                  <div style={{ marginBottom: '16px', textAlign: 'left' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '15px', fontWeight: '600', color: '#333' }}>
                      Как вам кухня?
                    </label>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <svg 
                          key={`food-${star}`} 
                          onClick={() => setRatingFood(star)}
                          style={{ cursor: 'pointer', width: '36px', height: '36px', fill: star <= ratingFood ? '#FFD700' : '#E0E0E0', transition: 'fill 0.2s' }}
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                        </svg>
                      ))}
                    </div>
                  </div>

                  {/* Оценка Сервиса */}
                  <div style={{ marginBottom: '20px', textAlign: 'left' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '15px', fontWeight: '600', color: '#333' }}>
                      Как вам обслуживание?
                    </label>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <svg 
                          key={`service-${star}`} 
                          onClick={() => setRatingService(star)}
                          style={{ cursor: 'pointer', width: '36px', height: '36px', fill: star <= ratingService ? '#FFD700' : '#E0E0E0', transition: 'fill 0.2s' }}
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                        </svg>
                      ))}
                    </div>
                  </div>

                  {/* Комментарий */}
                  <textarea 
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="Напишите пару слов..."
                    style={{
                      width: '100%', boxSizing: 'border-box', height: '80px', padding: '12px',
                      borderRadius: '12px', border: '1px solid #ddd', fontSize: '14px',
                      resize: 'none', marginBottom: '20px', backgroundColor: '#f9f9f9'
                    }}
                  />

                  {/* Кнопки */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button 
                      onClick={handleSubmitReview}
                      disabled={isProcessing}
                      style={{
                        padding: '14px', backgroundColor: '#111', color: '#fff', 
                        border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600',
                        opacity: isProcessing ? 0.7 : 1
                      }}
                    >
                      {isProcessing ? 'Отправка...' : (ratingFood || ratingService || reviewComment ? 'Отправить отзыв' : 'Пропустить')}
                    </button>
                  </div>
                </>
              ) : (
                /* Экран благодарности после отправки */
                <div style={{ padding: '20px 0' }}>
                  <svg style={{ width: '60px', height: '60px', fill: '#4CAF50', marginBottom: '16px' }} viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                  <h3 style={{ margin: '0 0 10px', fontSize: '22px', color: '#111' }}>Спасибо!</h3>
                  <p style={{ margin: '0', color: '#666', fontSize: '15px' }}>Ваше мнение очень важно для нас.</p>
                </div>
              )}

            </div>
          </div>
        )}
</ThemeProvider>
    </BrandingProvider>
  );
}
function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App;
