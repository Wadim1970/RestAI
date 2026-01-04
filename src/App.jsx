import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal'; 

function AppContent() {
  const location = useLocation();

  // --- ЛОГИКА ХРАНИЛИЩА (localStorage) ---

  // 1. Инициализируем корзину: пробуем взять из памяти, если там пусто — берем пустой объект {}
  const [cart, setCart] = useState(() => {
    const savedCart = localStorage.getItem('restaurant_cart');
    return savedCart ? JSON.parse(savedCart) : {};
  });

  // 2. Инициализируем заказы: пробуем взять из памяти, если пусто — пустой массив []
  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    const savedOrders = localStorage.getItem('restaurant_orders');
    return savedOrders ? JSON.parse(savedOrders) : [];
  });

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [viewHistory, setViewHistory] = useState([]);

  // Эффект: каждый раз, когда корзина меняется, записываем её в память браузера
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart));
  }, [cart]);

  // Эффект: каждый раз, когда заказы меняются, записываем их в память браузера
  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders));
  }, [confirmedOrders]);

  // --- УМНЫЙ ЗАМОК (твой код блокировки скролла) ---
  useEffect(() => {
    const isMainPage = location.pathname === '/';
    if (isMainPage || isChatOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.height = '100%';
      document.body.style.top = '0';
      document.body.style.left = '0';
      document.body.style.touchAction = 'none';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.touchAction = '';
    }
  }, [isChatOpen, location.pathname]);

  const handleToggleChatMode = (mode) => {
    setIsChatOpen(mode === 'chat');
  };

  const trackDishView = (dishName) => {
    setViewHistory(prev => {
      if (prev[prev.length - 1] === dishName) return prev;
      return [...prev, dishName].slice(-10);
    });
  };

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

  const handleConfirmOrder = (cartItems) => {
    setConfirmedOrders(prev => [...prev, ...cartItems]);
    setCart({}); // Очищаем корзину, но история (confirmedOrders) сохранится в localStorage
  };

  // Метод для полной очистки сессии (например, при оплате счета)
  const handleClearSession = () => {
    setCart({});
    setConfirmedOrders([]);
    localStorage.removeItem('restaurant_cart');
    localStorage.removeItem('restaurant_orders');
  };

  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<MainScreen onChatModeToggle={handleToggleChatMode} />} />
        <Route 
          path="/menu" 
          element={
            <MenuPage 
              cart={cart} 
              updateCart={updateCart} 
              confirmedOrders={confirmedOrders}
              onConfirmOrder={handleConfirmOrder}
              onOpenChat={() => setIsChatOpen(true)}
              trackDishView={trackDishView} 
            />
          } 
        />
      </Routes>

      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)} 
        viewHistory={viewHistory}
        onModeToggle={handleToggleChatMode} 
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
