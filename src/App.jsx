import React, { useState, useEffect } from 'react'; 
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; 
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal'; 

function AppContent() {
  const location = useLocation(); // Хук для отслеживания текущего пути (маршрута)

  // --- СОСТОЯНИЕ ИДЕНТИФИКАЦИИ (RestAI) ---
  // guestInfo хранит постоянный UUID гостя и его цифровой отпечаток (fingerprint)
  const [guestInfo, setGuestInfo] = useState({ uuid: '', fingerprint: '' });
  // currentSessionId меняется при каждом открытии чата, чтобы ИИ начинал с чистого листа
  const [currentSessionId, setCurrentSessionId] = useState('');

  // Эффект: выполняется один раз при загрузке приложения для опознания гостя
  useEffect(() => {
    // Пытаемся достать существующий UUID из памяти браузера
    let uuid = localStorage.getItem('restai_guest_uuid');
    if (!uuid) {
      // Если гость новый — генерируем ему уникальный UUID
      uuid = crypto.randomUUID();
      // И сохраняем его в память на будущее
      localStorage.setItem('restai_guest_uuid', uuid);
    }
    // Собираем базовые данные устройства для создания "отпечатка" (защита от очистки кеша)
    const fingerprintData = {
      ua: navigator.userAgent, // Данные браузера
      res: `${window.screen.width}x${window.screen.height}` // Разрешение экрана
    };
    // Кодируем данные в строку для удобной передачи
    const fingerprintHash = btoa(JSON.stringify(fingerprintData)).slice(0, 32);
    // Записываем данные в состояние
    setGuestInfo({ uuid, fingerprint: fingerprintHash });
  }, []);

  // --- СОСТОЯНИЕ КОРЗИНЫ ---
  const [cart, setCart] = useState(() => {
    // Загружаем сохраненную корзину из localStorage
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
  const [isChatOpen, setIsChatOpen] = useState(false); // Открыт ли чат
  const [viewHistory, setViewHistory] = useState([]); // История просмотров блюд
  const [chatContext, setChatContext] = useState(''); // Контекст (блюдо/раздел) для ИИ

  // Эффект: сохранение корзины при каждом её изменении
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart));
  }, [cart]);

  // Эффект: сохранение истории заказов
  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders));
  }, [confirmedOrders]);

  // --- УПРАВЛЕНИЕ СКРОЛЛОМ (БЕЗ POSITION FIXED, КОТОРЫЙ ЛОМАЛ КНОПКУ) ---
  useEffect(() => {
    const isMainPage = location.pathname === '/'; 
    // Если мы на главной или открыт чат — просто скрываем полосу прокрутки
    if (isMainPage || isChatOpen) {
      document.body.style.overflow = 'hidden'; 
      // ВНИМАНИЕ: Я убрал position: fixed и touchAction, чтобы кнопки оставались кликабельными
    } else {
      // Возвращаем стандартный скролл для страницы меню
      document.body.style.overflow = '';
    }
  }, [isChatOpen, location.pathname]);

  // --- ОБРАБОТЧИКИ ---

  // Новая универсальная функция открытия чата
  const handleOpenChat = (dish, currentSection) => {
    // Формируем текстовое описание для ИИ в зависимости от того, где открыт чат
    if (dish) {
      // Если открыли из карточки блюда
      setChatContext(`Блюдо: ${dish.dish_name}. Состав: ${dish.ingredients}`); 
    } else if (currentSection) {
      // Если открыли, листая категорию
      setChatContext(`Пользователь смотрит раздел: "${currentSection}"`);
    } else {
      // Общий вызов чата
      setChatContext('Общее меню');
    }

    // ГЕНЕРАЦИЯ СЕССИИ: Каждое открытие чата получает уникальный ID
    // Это гарантирует, что ИИ не будет путать блюда из разных открытий чата
    const newSession = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    setCurrentSessionId(newSession);

    // Показываем окно чата
    setIsChatOpen(true);
  };

  // Запись истории просмотров (до 10 позиций)
  const trackDishView = (dishName) => {
    setViewHistory(prev => {
      if (prev[prev.length - 1] === dishName) return prev; 
      return [...prev, dishName].slice(-10); 
    });
  };

  // Обновление корзины
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
        {/* Главная страница (заставка с видео) */}
        <Route 
          path="/" 
          element={
            <MainScreen 
              onChatModeToggle={(mode) => mode === 'chat' && handleOpenChat()} 
              isChatOpen={isChatOpen} 
            />
          } 
        />
        {/* Страница основного меню */}
        <Route 
          path="/menu" 
          element={
            <MenuPage 
              cart={cart} 
              updateCart={updateCart} 
              confirmedOrders={confirmedOrders}
              onConfirmOrder={handleConfirmOrder}
              onOpenChat={handleOpenChat} // Прокидываем нашу новую функцию открытия
              trackDishView={trackDishView} 
            />
          } 
        />
      </Routes>

      {/* Модальное окно чата: передаем контекст и все идентификаторы для n8n */}
      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={() => {
          setIsChatOpen(false); // Закрываем
          setChatContext('');   // Очищаем контекст для следующего раза
        }} 
        viewHistory={viewHistory}
        pageContext={chatContext} 
        guestUuid={guestInfo.uuid} // Постоянный ID для базы данных
        guestFingerprint={guestInfo.fingerprint} // Отпечаток устройства
        sessionId={currentSessionId} // Динамический ID текущей беседы
      />
    </div>
  );
}

// Корневой компонент с роутером
function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App;
