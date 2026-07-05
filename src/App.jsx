import React, { useState, useEffect } from 'react'; 
import { HashRouter, Routes, Route } from 'react-router-dom'; 
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal';
import SplitBillModal from './components/SplitBillModal/SplitBillModal';
import PaymentFlowModal from './components/PaymentFlowModal/PaymentFlowModal';
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
  }, []);

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
  const [isBillRequested, setIsBillRequested] = useState(false);
  const [isBillChoiceOpen, setIsBillChoiceOpen] = useState(false); // Верхний выбор: позвать официанта / оплатить самому
  const [isPayChoiceOpen, setIsPayChoiceOpen] = useState(false);   // Выбор: за себя / за весь стол
  const [billMode, setBillMode] = useState('pay');                 // 'waiter' | 'pay' — ветка, из которой пришли в выбор
  const [isSplitBillOpen, setIsSplitBillOpen] = useState(false);   // Экран выбора корзин по местам
  const [payFlowSeats, setPayFlowSeats] = useState(null);          // Места для оплаты -> открывает поток чек/СБП
  const [tableTotalAmount, setTableTotalAmount] = useState(0);
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

  const handleToggleChatMode = (newMode) => {
    // Логика переключения режима чата, если нужна
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
      quantity: item.count
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
    await finishGuestSession('waiter');
  } finally {
    setIsProcessing(false);
  }
};

// "За себя": в ветке официанта -> раздельный счёт; в ветке оплаты -> поток
// чек/СБП по своему месту (paid проставится только после подтверждения).
const handlePayChoiceOwn = () => {
  if (billMode === 'waiter') { callWaiterWithBill('personal'); return; }
  setIsPayChoiceOpen(false);
  if (seatNumber != null) setPayFlowSeats([seatNumber]);
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

// Гость выбрал места в SplitBillModal -> ведём в поток оплаты по этим местам.
const handleSplitBillConfirm = (seats) => {
  setIsSplitBillOpen(false);
  if (seats && seats.length > 0) setPayFlowSeats(seats);
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
    const handleSubmitReview = async () => {
    // Если ничего ��е заполнили, просто закрываем окно
    if (ratingFood === 0 && ratingService === 0 && reviewComment.trim() === '') {
        setIsBillRequested(false);
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
        
        // Автоматически закрываем окно через 3 секунды
        setTimeout(() => {
            setIsBillRequested(false);
            // Сбрасываем стейты на будущее
            setRatingFood(0);
            setRatingService(0);
            setReviewComment('');
            setIsReviewSubmitted(false);
        }, 3000);

    } catch (error) {
        console.error("Ошибка при отправке отзыва:", error);
        alert("Не удалось отправить отзыв, но спасибо за ваше время!");
        setIsBillRequested(false);
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
            element={<MainScreen onChatModeToggle={handleToggleChatMode} isChatOpen={isChatOpen} />} 
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
                onOpenChat={(dish, currentSection) => {
                  // Генерируем сессию ТОЛЬКО если ее еще нет
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
                  setIsChatOpen(true);
                }}
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
          }} 
          viewHistory={viewHistory}
          pageContext={chatContext}
          sessionId={currentSessionId}
          messages={chatMessages}
          setMessages={setChatMessages}
          restaurantId={restaurantId} // <-- ДОБАВИЛИ ЭТО
          guestId={guestId}           // <-- ДОБАВИЛИ ЭТО
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
