import React, { useState, useEffect } from 'react'; // Твои импорты
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; // Твои импорты
import MainScreen from './components/MainScreen'; // Твои импорты
import MenuPage from './components/MenuPage'; // Твои импорты
import AIChatModal from './components/AIChatModal/AIChatModal'; // Твои импорты

function AppContent() {
  const location = useLocation(); // Твоя строка

  // --- НОВОЕ: ТОЛЬКО ПЕРЕМЕННЫЕ ДЛЯ ИДЕНТИФИКАЦИИ ---
  const [guestInfo, setGuestInfo] = useState({ uuid: '', fingerprint: '' }); // Стейт для UUID гостя
  const [currentSessionId, setCurrentSessionId] = useState(''); // Стейт для ID текущей сессии чата

  // Эффект генерации ID (срабатывает тихо в фоне, не трогает экран и стили)
  useEffect(() => {
    let uuid = localStorage.getItem('restai_guest_uuid'); // Проверяем старый ID в памяти
    if (!uuid) {
      uuid = crypto.randomUUID(); // Создаем новый, если гость зашел впервые
      localStorage.setItem('restai_guest_uuid', uuid); // Сохраняем в память
    }
    const fp = btoa(navigator.userAgent).slice(0, 16); // Делаем простой отпечаток браузера
    setGuestInfo({ uuid, fingerprint: fp }); // Записываем данные в стейт
  }, []);

  // --- ТВОИ ОРИГИНАЛЬНЫЕ СОСТОЯНИЯ ---
  const [cart, setCart] = useState(() => {
    const savedCart = localStorage.getItem('restaurant_cart'); 
    return savedCart ? JSON.parse(savedCart) : {}; 
  }); // Твоя инициализация корзины

  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    const savedOrders = localStorage.getItem('restaurant_orders');
    return savedOrders ? JSON.parse(savedOrders) : []; 
  }); // Твоя инициализация заказов

  const [isChatOpen, setIsChatOpen] = useState(false); // Твой стейт чата
  const [viewHistory, setViewHistory] = useState([]); // Твой стейт истории
  const [chatContext, setChatContext] = useState(''); // Твой стейт контекста

  // Твои эффекты сохранения данных в localStorage
  useEffect(() => { localStorage.setItem('restaurant_cart', JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders)); }, [confirmedOrders]);

  // --- ТВОЕ УПРАВЛЕНИЕ СКРОЛЛОМ (ВЕРНУЛ КАК БЫЛО У ТЕБЯ) ---
  useEffect(() => {
    const isMainPage = location.pathname === '/'; // Твое условие
    if (isMainPage || isChatOpen) {
      document.body.style.overflow = 'hidden'; // Твоя строка
      document.body.style.position = 'fixed'; // Твоя строка
      document.body.style.width = '100%'; // Твоя строка
    } else {
      document.body.style.overflow = ''; // Твоя строка
      document.body.style.position = ''; // Твоя строка
      document.body.style.width = ''; // Твоя строка
    }
  }, [isChatOpen, location.pathname]); // Твои зависимости

  // --- ТВОИ ОБРАБОТЧИКИ (С ДОБАВЛЕНИЕМ СЕССИИ) ---
  const handleOpenChat = (dish, currentSection) => {
    if (dish) {
      setChatContext(`Блюдо: ${dish.dish_name}. Описание: ${dish.description}. Состав: ${dish.ingredients}`); 
    } else if (currentSection) {
      setChatContext(`Пользователь сейчас просматривает раздел меню: "${currentSection}"`);
    } else {
      setChatContext('Общее меню ресторана');
    }
    // Генерируем новую сессию только в момент открытия чата
    setCurrentSessionId(`sess_${Date.now()}`);
    setIsChatOpen(true); // Открываем чат
  };

  const trackDishView = (dishName) => {
    setViewHistory(prev => {
      if (prev[prev.length - 1] === dishName) return prev; 
      return [...prev, dishName].slice(-10); 
    });
  }; // Твоя функция трекинга

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
  }; // Твоя функция корзины

  const handleConfirmOrder = (cartItems) => {
    setConfirmedOrders(prev => [...prev, ...cartItems]);
    setCart({}); 
  }; // Твоя функция заказа

  return (
    <div className="App">
      <Routes>
        <Route 
          path="/" 
          element={<MainScreen onChatModeToggle={(mode) => mode === 'chat' && handleOpenChat()} isChatOpen={isChatOpen} />} 
        />
        <Route 
          path="/menu" 
          element={
            <MenuPage 
              cart={cart} 
              updateCart={updateCart} 
              confirmedOrders={confirmedOrders}
              onConfirmOrder={handleConfirmOrder}
              onOpenChat={handleOpenChat}
              trackDishView={trackDishView} 
            />
          } 
        />
      </Routes>

      {/* Модалка чата с твоим набором пропсов + новые ID */}
      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={() => {
          setIsChatOpen(false); 
          setChatContext('');   
        }} 
        viewHistory={viewHistory}
        pageContext={chatContext} 
        guestUuid={guestInfo.uuid} // Передаем ID гостя
        guestFingerprint={guestInfo.fingerprint} // Передаем отпечаток
        sessionId={currentSessionId} // Передаем ID сессии
      />
    </div>
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
