import React, { useState, useEffect } from 'react'; 
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; 
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal'; 

function AppContent() {
  const location = useLocation();

  // ID для RestAI
  const [guestInfo, setGuestInfo] = useState({ uuid: '', fingerprint: '' });
  const [currentSessionId, setCurrentSessionId] = useState('');

  // Генерация UUID гостя
  useEffect(() => {
    let uuid = localStorage.getItem('restai_guest_uuid');
    if (!uuid) {
      uuid = crypto.randomUUID();
      localStorage.setItem('restai_guest_uuid', uuid);
    }
    const fp = btoa(navigator.userAgent).slice(0, 16);
    setGuestInfo({ uuid, fingerprint: fp });
  }, []);

  // Состояния корзины, заказов и чата
  const [cart, setCart] = useState(() => {
    const saved = localStorage.getItem('restaurant_cart');
    return saved ? JSON.parse(saved) : {};
  });

  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    const saved = localStorage.getItem('restaurant_orders');
    return saved ? JSON.parse(saved) : [];
  });

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [viewHistory, setViewHistory] = useState([]);
  const [chatContext, setChatContext] = useState('');

  useEffect(() => localStorage.setItem('restaurant_cart', JSON.stringify(cart)), [cart]);
  useEffect(() => localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders)), [confirmedOrders]);

  // Управление скроллом
  useEffect(() => {
    const isMainPage = location.pathname === '/';
    if (isMainPage || isChatOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.touchAction = 'none';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.touchAction = '';
    }
  }, [isChatOpen, location.pathname]);

  // ОБРАБОТЧИК ДЛЯ ГЛАВНОГО ЭКРАНА (ИСПРАВЛЕН)
  const handleToggleChatMode = () => {
    console.log("Вызов чата с главной..."); // Теперь ты увидишь это в консоли
    setCurrentSessionId(`sess_${Date.now()}`);
    setChatContext('Общее меню ресторана');
    setIsChatOpen(true);
  };

  const trackDishView = (dishName) => {
    setViewHistory(prev => (prev[prev.length - 1] === dishName ? prev : [...prev, dishName].slice(-10)));
  };

  const updateCart = (dishId, delta) => {
    setCart(prev => {
      const newCount = Math.max(0, (prev[dishId] || 0) + delta);
      if (newCount === 0) { const { [dishId]: _, ...rest } = prev; return rest; }
      return { ...prev, [dishId]: newCount };
    });
  };

  const handleConfirmOrder = (items) => {
    setConfirmedOrders(prev => [...prev, ...items]);
    setCart({});
  };

  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<MainScreen onChatModeToggle={handleToggleChatMode} isChatOpen={isChatOpen} />} />
        <Route path="/menu" element={
          <MenuPage 
            cart={cart} updateCart={updateCart} confirmedOrders={confirmedOrders} onConfirmOrder={handleConfirmOrder}
            onOpenChat={(dish, section) => {
              console.log("Открытие чата из меню..."); 
              setChatContext(dish ? `Блюдо: ${dish.dish_name}. Состав: ${dish.ingredients}` : `Раздел: ${section}`);
              setCurrentSessionId(`sess_${Date.now()}`);
              setIsChatOpen(true);
            }}
            trackDishView={trackDishView}
          />
        } />
      </Routes>

      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)} 
        pageContext={chatContext}
        guestUuid={guestInfo.uuid}
        guestFingerprint={guestInfo.fingerprint}
        sessionId={currentSessionId}
      />
    </div>
  );
}

function App() { return <HashRouter><AppContent /></HashRouter>; }
export default App;
