import React, { useState, useEffect } from 'react'; 
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; 
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal'; 

function AppContent() {
  const location = useLocation(); // Хук для отслеживания текущего пути (маршрута)

  // --- СОСТОЯНИЕ ИДЕНТИФИКАЦИИ ГОСТЯ (ПЛАТФОРМА RestAI) ---
  const [guestInfo, setGuestInfo] = useState({
    uuid: '',        // Постоянный ID для Supabase
    fingerprint: ''  // Цифровой отпечаток устройства
  });

  // --- СОСТОЯНИЕ ДИНАМИЧЕСКОЙ СЕССИИ (ДЛЯ ПАМЯТИ ИИ) ---
  const [currentSessionId, setCurrentSessionId] = useState(''); // Сбрасывает память ИИ при смене блюда

  // --- СОСТОЯНИЕ КОРЗИНЫ ---
  const [cart, setCart] = useState(() => {
    // Загружаем данные корзины из localStorage при инициализации
    const savedCart = localStorage.getItem('restaurant_cart'); 
    return savedCart ? JSON.parse(savedCart) : {}; 
  });

  // --- СОСТОЯНИЕ ЗАКАЗОВ ---
  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    // Загружаем историю подтвержденных заказов
    const savedOrders = localStorage.getItem('restaurant_orders');
    return savedOrders ? JSON.parse(savedOrders) : []; 
  });

  // --- СОСТОЯНИЕ МОДАЛКИ И КОНТЕКСТА ---
  const [isChatOpen, setIsChatOpen] = useState(false); // Состояние: открыт ли чат с ИИ
  const [viewHistory, setViewHistory] = useState([]); // История просмотренных блюд (массив имен)
  const [chatContext, setChatContext] = useState(''); // Контекст для ИИ (данные о блюде или разделе)

  // ЭФФЕКТ: Идентификация пользователя при загрузке приложения
  useEffect(() => {
    // 1. Работа с UUID (постоянный маркер)
    let uuid = localStorage.getItem('restai_guest_uuid');
    if (!uuid) {
      uuid = crypto.randomUUID(); // Генерируем новый, если гость зашел впервые
      localStorage.setItem('restai_guest_uuid', uuid);
    }

    // 2. Сбор признаков для Fingerprint (устройство, экран, язык)
    const fingerprintData = {
      ua: navigator.userAgent, // Браузер и ОС
      res: `${window.screen.width}x${window.screen.height}`, // Разрешение экрана
      lang: navigator.language, // Язык системы
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone, // Часовой пояс
      mem: navigator.deviceMemory || 'unknown' // Примерный объем ОЗУ (если доступно)
    };
    
    // Превращаем данные в короткую строку-хэш
    const fingerprintHash = btoa(JSON.stringify(fingerprintData)).slice(0, 32);

    // Сохраняем "паспорт" гостя в стейт
    setGuestInfo({ uuid, fingerprint: fingerprintHash });
  }, []);

  // Эффект: сохранение корзины в память браузера при каждом её изменении
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart));
  }, [cart]);

  // Эффект: сохранение истории заказов в память браузера
  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders));
  }, [confirmedOrders]);

  // --- УПРАВЛЕНИЕ СКРОЛЛОМ И ЖЕСТАМИ ---
  useEffect(() => {
    const isMainPage = location.pathname === '/'; 
    if (isMainPage || isChatOpen) {
      document.body.style.overflow = 'hidden'; 
      document.body.style.position = 'fixed'; 
      document.body.style.width = '100%'; 
      document.body.style.height = '100%'; 
      document.body.style.touchAction = 'none'; 
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.touchAction = '';
    }
  }, [isChatOpen, location.pathname]);

  // --- ОБРАБОТЧИКИ ---

  // Универсальная функция открытия чата (с обновлением сессии и контекста)
  const handleOpenChat = (dish, currentSection) => {
    // 1. Установка контекста (блюдо или раздел)
    if (dish) {
      const info = `Блюдо: ${dish.dish_name}. Описание: ${dish.description}. Состав: ${dish.ingredients}`;
      setChatContext(info); 
    } else if (currentSection) {
      setChatContext(`Пользователь сейчас просматривает раздел меню: "${currentSection}"`);
    } else {
      setChatContext('Общее меню ресторана');
    }

    // 2. ГЕНЕРАЦИЯ ДИНАМИЧЕСКОГО ID СЕССИИ (чтобы ИИ не путал Карбонару с Пепперони)
    // Мы создаем уникальный ключ для текущего входа в чат
    const newSession = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    setCurrentSessionId(newSession);

    // 3. Открытие модалки
    setIsChatOpen(true);
  };

  // Запись истории просмотров (последние 10)
  const trackDishView = (dishName) => {
    setViewHistory(prev => {
      if (prev[prev.length - 1] === dishName) return prev; 
      return [...prev, dishName].slice(-10); 
    });
  };

  // Изменение количества товара в корзине
  const updateCart = (dishId, delta) => {
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

  // Подтверждение заказа
  const handleConfirmOrder = (cartItems) => {
    setConfirmedOrders(prev => [...prev, ...cartItems]);
    setCart({}); 
  };

  return (
    <div className="App">
      <Routes>
        <Route 
          path="/" 
          element={
            <MainScreen 
              onChatModeToggle={(mode) => mode === 'chat' && handleOpenChat()} 
              isChatOpen={isChatOpen} 
            />
          } 
        />
        <Route 
          path="/menu" 
          element={
            <MenuPage 
              cart={cart} 
              updateCart={updateCart} 
              confirmedOrders={confirmedOrders}
              onConfirmOrder={handleConfirmOrder}
              onOpenChat={handleOpenChat} // Используем обновленную функцию с ID сессии
              trackDishView={trackDishView} 
            />
          } 
        />
      </Routes>

      {/* Модальное окно чата с ИИ */}
      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={() => {
          setIsChatOpen(false); 
          setChatContext('');   
        }} 
        viewHistory={viewHistory}
        pageContext={chatContext} 
        // ПЕРЕДАЕМ ДАННЫЕ ПЛАТФОРМЫ RESTAI
        guestUuid={guestInfo.uuid}           // Для записи в Supabase (кто это?)
        guestFingerprint={guestInfo.fingerprint} // Для доп. идентификации
        sessionId={currentSessionId}         // Для памяти n8n (какой сейчас разговор?)
      />
    </div>
  );
}

// Обертка с HashRouter для корректной навигации в веб-окружениях
function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App;
